import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  CACHE_DIR,
  IMAGE_MODEL,
  LOCATION,
  PORT,
  PROMPT_MODEL,
  ROOT,
  hasOpenRouterKey,
} from "./config";
import { isSafeImageFile, pruneCache } from "./cache";
import { getImageState, startGeneration } from "./imageGen";
import { getWeather } from "./weather";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    hasKey: hasOpenRouterKey(),
    models: { prompt: PROMPT_MODEL, image: IMAGE_MODEL },
    location: LOCATION,
  });
});

app.get("/api/weather", async (req, res) => {
  const force = req.query.refresh === "1";
  const weather = await getWeather(force);
  res.set("Cache-Control", "no-store");
  res.json(weather);
});

app.get("/api/image", async (_req, res) => {
  const state = await getImageState();
  res.set("Cache-Control", "no-store");
  res.json(state);
});

app.post("/api/image", async (req, res) => {
  const force = req.body?.force === true;
  const state = await startGeneration(force);
  res.set("Cache-Control", "no-store");
  res.status(state.status === "generating" ? 202 : 200).json(state);
});

app.get("/api/image/file/:file", (req, res) => {
  const file = String(req.params.file ?? "");
  if (!isSafeImageFile(file)) {
    res.status(400).json({ error: "Invalid image file." });
    return;
  }

  const full = path.join(CACHE_DIR, file);
  if (!existsSync(full)) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(full);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

const dist = path.join(ROOT, "dist");

if (process.env.NODE_ENV === "production") {
  if (!existsSync(dist)) {
    console.warn("[server] dist/ not found. Run `npm run build` first.");
  } else {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (
        (req.method !== "GET" && req.method !== "HEAD") ||
        req.path.startsWith("/api/")
      ) {
        next();
        return;
      }
      res.sendFile(path.join(dist, "index.html"));
    });
  }
} else {
  app.get("/", (_req, res) => {
    res.json({
      message: "API server. Open the Vite app at http://localhost:5173.",
    });
  });
}

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[api]", err);
    if (res.headersSent) return;
    const message =
      err instanceof Error ? err.message : "Unexpected server error.";
    res.status(500).json({ error: message });
  },
);

app.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`);
  if (!hasOpenRouterKey()) {
    console.warn(
      "[server] OPENROUTER_API_KEY is not set. Weather works; image generation is disabled.",
    );
  }
  void pruneCache();
});
