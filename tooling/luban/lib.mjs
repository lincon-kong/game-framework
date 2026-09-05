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

export function resolveLubanDll() {
  const dll = resolve(frameworkRoot, "tooling", "luban", "Luban", "Luban.dll");
  if (!existsSync(dll)) {
    throw new Error(`Framework-owned Luban is missing: ${dll}. Install/vendor the pinned Luban distribution in game-framework/tooling/luban/Luban.`);
  }
  return dll;
}
