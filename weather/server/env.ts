import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Minimal .env parser. The lab's openrouter.env uses `export KEY=value`,
 * so strip an optional `export ` prefix. Existing environment variables win.
 */
function parseEnv(contents: string): void {
  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;

  }
}

export function loadEnv(root: string): void {
  for (const name of ["openrouter.env", ".env"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    try {
      parseEnv(readFileSync(file, "utf8"));
    } catch (err) {
      console.warn(`[env] could not read ${name}:`, err);
    }
  }
}
