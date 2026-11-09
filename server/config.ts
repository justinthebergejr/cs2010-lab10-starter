import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, independent of the current working directory. */
export const ROOT = path.resolve(here, "..");

// Load openrouter.env / .env before reading any process.env values below.
loadEnv(ROOT);

export const PORT = Number(process.env.PORT ?? 3000);

export const LOCATION = {
  name: process.env.WEATHER_NAME ?? "Plymouth, NH",
  zip: process.env.WEATHER_ZIP ?? "03264",
  latitude: Number(process.env.WEATHER_LAT ?? 43.7589),
  longitude: Number(process.env.WEATHER_LON ?? -71.6892),
};

export const TIME_ZONE = process.env.WEATHER_TZ ?? "America/New_York";

export const REFERENCE_IMAGE_PATH = path.join(ROOT, "public", "panther-snow.jpg");
export const REFERENCE_URL = "/panther-snow.jpg";

export const CACHE_DIR = path.join(ROOT, "output", "weather");

export const PROMPT_MODEL =
  process.env.PROMPT_MODEL ?? "google/gemini-3.5-flash-lite";
export const IMAGE_MODEL =
  process.env.IMAGE_MODEL ?? "qwen/qwen-image-2.1-turbo";
export const IMAGE_ASPECT_RATIO = process.env.IMAGE_ASPECT_RATIO ?? "1:1";
export const IMAGE_RESOLUTION = process.env.IMAGE_RESOLUTION ?? "1K";

export const PROMPT_VERSION = "1";

export const WEATHER_CACHE_MS = 10 * 60 * 1000;
export const IMAGE_CACHE_MS = 3 * 60 * 60 * 1000;
export const MIN_GENERATION_GAP_MS = 15 * 1000;

export const NWS_USER_AGENT =
  process.env.NWS_USER_AGENT ??
  "cs2010-weather-postcard/1.0 (student project; https://homework.quest/classes/2026-09/cs2010/)";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const REFERENCE_HASH = (() => {
  try {
    return createHash("sha256")
      .update(readFileSync(REFERENCE_IMAGE_PATH))
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "missing-reference";
  }
})();

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function referenceExists(): boolean {
  return existsSync(REFERENCE_IMAGE_PATH);
}
