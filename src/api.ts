import type { ImageState, Weather } from "../shared/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  url: string,
  init?: RequestInit,
  attempt = 1,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (attempt < 2) {
      await sleep(700);
      return request<T>(url, init, attempt + 1);
    }
    throw err;
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const payload = body as { error?: string; message?: string } | null;
    throw new Error(
      payload?.error ??
        payload?.message ??
        `Request failed: HTTP ${response.status}`,
    );
  }

  return body as T;
}

export function fetchWeather(refresh = false): Promise<Weather> {
  return request<Weather>(`/api/weather${refresh ? "?refresh=1" : ""}`);
}

export function fetchImageState(): Promise<ImageState> {
  return request<ImageState>("/api/image");
}

export function startGeneration(force = false): Promise<ImageState> {
  return request<ImageState>("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
}
