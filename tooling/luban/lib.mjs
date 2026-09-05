import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { frameworkRoot, gamePath } from "../lib/game-config.mjs";

export function loadLubanSource(gameRoot, section) {
  const configPath = gamePath(gameRoot, section.config ?? "data/luban.conf");
  if (!existsSync(configPath)) {
    throw new Error(`Missing Luban config: ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const configDir = dirname(configPath);
  for (const schema of config.schemaFiles ?? []) {
    const file = resolve(configDir, schema.fileName);
    if (!existsSync(file)) throw new Error(`Missing Luban schema source: ${file}`);
  }
  if (config.dataDir) {
    const dataDir = resolve(configDir, config.dataDir);
    if (!existsSync(dataDir)) throw new Error(`Missing Luban data directory: ${dataDir}`);
  }
  return { configPath, config };
}

export function resolveLubanDll(gameRoot, section) {
  const candidates = [
    section.dll ? gamePath(gameRoot, section.dll) : undefined,
    resolve(frameworkRoot, "tooling", "luban", "Luban", "Luban.dll"),
    resolve(gameRoot, "tools", "luban", "Luban", "Luban.dll"),
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(`Luban.dll not found. Checked:\n${candidates.map(x => `- ${x}`).join("\n")}`);
  }
  return found;
}
