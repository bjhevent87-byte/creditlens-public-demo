import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadEnvironment(rootDir) {
  const env = { ...process.env };
  const candidates = [path.join(rootDir, ".env"), path.join(rootDir, ".env.local")];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const body = readFileSync(filePath, "utf8");
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || env[match[1]]) continue;
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return env;
}
