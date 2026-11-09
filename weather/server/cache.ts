import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageMetadata } from "../shared/types";
import { CACHE_DIR, IMAGE_CACHE_MS } from "./config";

const IMAGE_FILE_RE = /^[a-z0-9-]+\.(png|jpe?g|webp)$/i;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

export function cacheImagePath(file: string): string {
  return path.join(CACHE_DIR, file);
}

export function isSafeImageFile(file: string): boolean {
  return path.basename(file) === file && IMAGE_FILE_RE.test(file);
}

async function readMetadataFile(file: string): Promise<ImageMetadata | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, file), "utf8");
    const meta = JSON.parse(raw) as ImageMetadata;
    if (!meta.signature || !meta.imageFile || !meta.generatedAt) return null;
    if (!isSafeImageFile(meta.imageFile)) return null;

    const imageStat = await stat(cacheImagePath(meta.imageFile));
    if (!imageStat.isFile() || imageStat.size === 0) return null;

    return meta;
  } catch {
    return null;
  }
}

function isFresh(meta: ImageMetadata): boolean {
  const generated = new Date(meta.generatedAt).getTime();
  if (Number.isNaN(generated)) return false;
  return Date.now() - generated <= IMAGE_CACHE_MS;
}

export async function readMetadata(signature: string): Promise<ImageMetadata | null> {
  const meta = await readMetadataFile(`${signature}.json`);
  if (!meta || meta.signature !== signature || !isFresh(meta)) return null;
  return meta;
}

export async function readLatestMetadata(): Promise<ImageMetadata | null> {
  let files: string[];
  try {
    files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }

  const metas = (await Promise.all(files.map((f) => readMetadataFile(f))))
    .filter((m): m is ImageMetadata => m != null && isFresh(m))
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

  return metas[0] ?? null;
}

export async function writeMetadata(meta: ImageMetadata): Promise<void> {
  await ensureCacheDir();
  await writeFile(
    path.join(CACHE_DIR, `${meta.signature}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

export async function pruneCache(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return;
  }

  const cutoff = Date.now() - MAX_CACHE_AGE_MS;
  await Promise.all(
    files.map(async (file) => {
      const full = path.join(CACHE_DIR, file);
      try {
        const info = await stat(full);
        if (info.isFile() && info.mtimeMs < cutoff) await unlink(full);
      } catch {
        // Ignore files that disappear or cannot be removed.
      }
    }),
  );
}
