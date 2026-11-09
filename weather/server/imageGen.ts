import { readFile, writeFile } from "node:fs/promises";
import type { ImageMetadata, ImageState, Weather } from "../shared/types";
import {
  IMAGE_ASPECT_RATIO,
  IMAGE_CACHE_MS,
  IMAGE_MODEL,
  IMAGE_RESOLUTION,
  MIN_GENERATION_GAP_MS,
  OPENROUTER_BASE,
  PROMPT_MODEL,
  REFERENCE_IMAGE_PATH,
  REFERENCE_URL,
  hasOpenRouterKey,
} from "./config";
import {
  cacheImagePath,
  ensureCacheDir,
  readLatestMetadata,
  readMetadata,
  writeMetadata,
} from "./cache";
import { getWeather, weatherHints } from "./weather";

class OpenRouterError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

interface PromptResult {
  prompt: string;
  caption: string;
  source: "llm" | "fallback";
  costUsd: number | null;
}

interface ImageResult {
  bytes: Buffer;
  mediaType: string;
  prompt: string;
  costUsd: number | null;
}

let state: ImageState = { status: "idle" };
let inFlight: Promise<void> | null = null;
let lastStart = 0;
let referenceCache: string | null = null;

const SYSTEM_PROMPT = `You are the art director for a weather-reactive photograph. You will see a reference photograph and a weather report for Plymouth, New Hampshire. Write one vivid image-editing prompt for an image-to-image model.

The result must clearly show the reported time of day, season, and weather while preserving the reference photo's main subject, pose, camera angle, framing, and recognizable setting. If the reference contains a statue or sculpture, keep it as a statue, not a living creature. Change the sky, lighting, shadows, ground cover, foliage, precipitation, and atmosphere. Remove snow if the report is not snowy; add snow if it is. Make rain, snow, fog, wind, or sunshine immediately legible. Do not add text, watermarks, people, logos, or new objects.

Return only JSON with this shape: {"prompt":"...","caption":"one sentence describing the resulting scene"}. The prompt should be 2-5 sentences and under 900 characters.`;

function disabledState(): ImageState {
  return {
    status: "disabled",
    message:
      "OPENROUTER_API_KEY is not set. Add it to openrouter.env and restart the server to enable image generation.",
    canGenerate: false,
    referenceUrl: REFERENCE_URL,
  };
}

function readyState(meta: ImageMetadata, stale: boolean, cached: boolean): ImageState {
  return {
    status: "ready",
    imageUrl: `/api/image/file/${meta.imageFile}`,
    signature: meta.signature,
    stale,
    cached,
    generatedAt: meta.generatedAt,
    prompt: meta.prompt,
    caption: meta.caption,
    promptSource: meta.promptSource,
    weatherContext: meta.weatherContext,
    models: meta.models,
    costUsd: meta.costUsd,
    durationMs: meta.durationMs,
    referenceUrl: REFERENCE_URL,
    canGenerate: true,
  };
}

function parseErrorMessage(text: string): string {
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    return json.error?.message ?? json.message ?? text.slice(0, 400);
  } catch {
    return text.slice(0, 400) || "OpenRouter request failed.";
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof OpenRouterError) {
    switch (err.status) {
      case 401:
        return "OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY in openrouter.env.";
      case 402:
        return "OpenRouter says the account has insufficient credits (402).";
      case 403:
        return "OpenRouter blocked the request (403). Check the key's spend limit or model access.";
      case 404:
        return "OpenRouter could not find the requested model (404).";
      case 429:
        return "OpenRouter rate-limited the request (429). Wait a minute and try again.";
      default:
        return `OpenRouter error ${err.status}: ${err.message}`;
    }
  }

  if (err instanceof Error) {
    if (err.name === "TimeoutError" || /timeout|aborted/i.test(err.message)) {
      return "The model took too long to respond. Try again.";
    }
    return err.message.slice(0, 400);
  }

  return "Unexpected image-generation error.";
}

function openRouterHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:5173",
    "X-Title": "Plymouth Weather Postcard",
  };
}

async function getReference(): Promise<string> {
  if (referenceCache) return referenceCache;
  try {
    const bytes = await readFile(REFERENCE_IMAGE_PATH);
    referenceCache = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    return referenceCache;
  } catch {
    throw new Error("Reference image not found at weather/public/panther-snow.jpg.");
  }
}

function costOf(json: unknown): number | null {
  const usage = (json as { usage?: { cost?: unknown } } | null)?.usage;
  return typeof usage?.cost === "number" ? usage.cost : null;
}

function addCosts(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function extensionFor(mediaType: string): string {
  if (/jpe?g/i.test(mediaType)) return "jpg";
  if (/webp/i.test(mediaType)) return "webp";
  return "png";
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new OpenRouterError(parseErrorMessage(text), response.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function extractText(json: unknown): string {
  const content = (
    json as {
      choices?: Array<{ message?: { content?: unknown } }>;
    }
  )?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The art-direction model did not return a JSON object.");
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

async function createPrompt(
  weather: Weather,
  referenceDataUrl: string,
  key: string,
): Promise<PromptResult> {
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(key),
    body: JSON.stringify({
      model: PROMPT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Reference photograph and weather report:\n\n${weather.imageContext}\n\nWrite the image-editing prompt now.`,
            },
            { type: "image_url", image_url: { url: referenceDataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const json = await parseJsonResponse(response, "Art-direction model");
  const parsed = parseJsonObject(extractText(json));
  const prompt =
    typeof parsed.prompt === "string" ? parsed.prompt.trim().slice(0, 1600) : "";

  if (!prompt) {
    throw new Error("The art-direction model returned an empty prompt.");
  }

  const caption =
    typeof parsed.caption === "string" && parsed.caption.trim()
      ? parsed.caption.trim().slice(0, 240)
      : fallbackCaption(weather);

  return {
    prompt,
    caption,
    source: "llm",
    costUsd: costOf(json),
  };
}

async function postImage(
  body: Record<string, unknown>,
  key: string,
): Promise<Response> {
  return fetch(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: openRouterHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
}

async function createImage(
  prompt: string,
  referenceDataUrl: string,
  key: string,
): Promise<ImageResult> {
  const finalPrompt = `${prompt}\n\nPreserve the reference image's main subject, pose, composition, and framing. Keep any statue or sculpture as a statue. Photorealistic, natural light, no text, no watermark, no people, no logos.`;

  const body: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt: finalPrompt,
    input_references: [
      { type: "image_url", image_url: { url: referenceDataUrl } },
    ],
    n: 1,
    aspect_ratio: IMAGE_ASPECT_RATIO,
    resolution: IMAGE_RESOLUTION,
  };

  let response = await postImage(body, key);

  if (!response.ok) {
    const text = await response.text();
    const canRetryWithoutHints =
      response.status === 400 && /aspect|resolution|unsupported|unknown/i.test(text);

    if (canRetryWithoutHints) {
      delete body.aspect_ratio;
      delete body.resolution;
      response = await postImage(body, key);
      if (!response.ok) {
        const retryText = await response.text();
        throw new OpenRouterError(parseErrorMessage(retryText), response.status);
      }
    } else {
      throw new OpenRouterError(parseErrorMessage(text), response.status);
    }
  }

  const json = (await response.json()) as {
    data?: Array<{ b64_json?: string; media_type?: string }>;
    usage?: { cost?: unknown };
  };

  const item = json.data?.[0];
  if (!item?.b64_json) {
    throw new Error("The image model returned no image data.");
  }

  const base64 = String(item.b64_json).replace(/^data:[^;]+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) {
    throw new Error("The image model returned an empty image.");
  }

  return {
    bytes,
    mediaType: typeof item.media_type === "string" ? item.media_type : "image/png",
    prompt: finalPrompt,
    costUsd: costOf(json),
  };
}

function fallbackCaption(weather: Weather): string {
  return `${weather.current.shortForecast} in Plymouth, NH — ${weather.timeOfDay}, ${weather.season}.`;
}

function fallbackPrompt(weather: Weather): string {
  const current = weather.current;
  const unit = `°${current.temperatureUnit}`;
  const hints = weatherHints(current.shortForecast, current.precipProbability);

  return `Edit the reference photograph to match ${weather.timeOfDay} in ${weather.season} in Plymouth, New Hampshire. The weather is ${current.shortForecast.toLowerCase()}, ${current.temperature}${unit}, with wind ${current.windDirection} ${current.windSpeed} and a ${current.precipProbability ?? 0}% chance of precipitation. Today's high is ${weather.today.high ?? current.temperature}${unit} and the low is ${weather.today.low ?? current.temperature}${unit}. ${hints} Preserve the main subject, pose, camera angle, and framing. Keep any statue as a statue. Change the sky, light, shadows, ground, foliage, and atmosphere. Photorealistic, natural light, no text, no people, no logos.`;
}

async function runGeneration(weather: Weather, signature: string): Promise<void> {
  const started = Date.now();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");

  const referenceDataUrl = await getReference();

  state = { ...state, stage: "prompt" };

  let promptResult: PromptResult;
  try {
    promptResult = await createPrompt(weather, referenceDataUrl, key);
  } catch (err) {
    console.warn(
      "[image] prompt model failed; using fallback prompt:",
      friendlyError(err),
    );
    promptResult = {
      prompt: fallbackPrompt(weather),
      caption: fallbackCaption(weather),
      source: "fallback",
      costUsd: null,
    };
  }

  state = { ...state, stage: "image" };
  const imageResult = await createImage(
    promptResult.prompt,
    referenceDataUrl,
    key,
  );

  await ensureCacheDir();
  const extension = extensionFor(imageResult.mediaType);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const imageFile = `${signature}-${stamp}.${extension}`;
  await writeFile(cacheImagePath(imageFile), imageResult.bytes);

  const meta: ImageMetadata = {
    signature,
    imageFile,
    prompt: imageResult.prompt,
    caption: promptResult.caption,
    promptSource: promptResult.source,
    weatherContext: weather.imageContext,
    models: { prompt: PROMPT_MODEL, image: IMAGE_MODEL },
    generatedAt: new Date().toISOString(),
    costUsd: addCosts(promptResult.costUsd, imageResult.costUsd),
    referenceUrl: REFERENCE_URL,
    durationMs: Date.now() - started,
  };

  await writeMetadata(meta);
  state = readyState(meta, false, false);

  console.log(
    `[image] ready in ${(meta.durationMs / 1000).toFixed(1)}s: ${imageFile} (${(
      imageResult.bytes.length / 1024
    ).toFixed(0)} KB, cost ${
      meta.costUsd != null ? `$${meta.costUsd.toFixed(4)}` : "unknown"
    })`,
  );
}

export async function getImageState(): Promise<ImageState> {
  if (!hasOpenRouterKey()) return disabledState();

  let weather: Weather;
  try {
    weather = await getWeather();
  } catch (err) {
    return {
      status: "error",
      error: `Could not load weather: ${friendlyError(err)}`,
      canGenerate: true,
      referenceUrl: REFERENCE_URL,
    };
  }

  const signature = weather.imageSignature;

  if (state.status === "generating") return { ...state };

  if (state.status === "ready" && state.signature === signature) {
    const age = state.generatedAt
      ? Date.now() - new Date(state.generatedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (age <= IMAGE_CACHE_MS) return { ...state };
  }

  const cached = await readMetadata(signature);
  if (cached) {
    state = readyState(cached, false, true);
    return { ...state };
  }

  const latest = await readLatestMetadata();
  if (latest) {
    state = readyState(latest, latest.signature !== signature, true);
    return { ...state };
  }

  state = {
    status: "idle",
    signature,
    canGenerate: true,
    referenceUrl: REFERENCE_URL,
  };
  return { ...state };
}

export async function startGeneration(force = false): Promise<ImageState> {
  if (!hasOpenRouterKey()) return disabledState();
  if (inFlight) return { ...state };

  const now = Date.now();
  if (now - lastStart < MIN_GENERATION_GAP_MS) {
    const wait = Math.ceil((MIN_GENERATION_GAP_MS - (now - lastStart)) / 1000);
    return {
      ...state,
      message: `Please wait ${wait}s before starting another image.`,
    };
  }
  lastStart = now;

  let weather: Weather;
  try {
    weather = await getWeather(force);
  } catch (err) {
    return {
      status: "error",
      error: `Could not load weather: ${friendlyError(err)}`,
      canGenerate: true,
      referenceUrl: REFERENCE_URL,
    };
  }

  const signature = weather.imageSignature;

  if (!force) {
    const cached = await readMetadata(signature);
    if (cached) {
      state = readyState(cached, false, true);
      return { ...state };
    }
  }

  const previous: Partial<ImageState> =
    state.status === "ready" || state.status === "error"
      ? {
          imageUrl: state.imageUrl,
          generatedAt: state.generatedAt,
          prompt: state.prompt,
          caption: state.caption,
          promptSource: state.promptSource,
          weatherContext: state.weatherContext,
          models: state.models,
          costUsd: state.costUsd,
          durationMs: state.durationMs,
        }
      : {};

  state = {
    status: "generating",
    stage: "prompt",
    signature,
    startedAt: Date.now(),
    canGenerate: true,
    referenceUrl: REFERENCE_URL,
    ...previous,
  };

  inFlight = runGeneration(weather, signature)
    .catch((err) => {
      const message = friendlyError(err);
      console.error("[image] generation failed:", message);
      state = {
        ...state,
        status: "error",
        error: message,
        stage: undefined,
        canGenerate: true,
      };
    })
    .finally(() => {
      inFlight = null;
    });

  return { ...state };
}
