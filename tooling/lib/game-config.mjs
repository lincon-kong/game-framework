import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const toolingRoot = resolve(here, "..");
export const frameworkRoot = resolve(toolingRoot, "..");

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function loadGameConfig() {
  const gameRoot = resolve(argValue("--game-root") ?? process.cwd());
  const configPath = resolve(gameRoot, argValue("--config") ?? "game-tools.json");
  if (!existsSync(configPath)) {
    throw new Error(`Missing game toolchain config: ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return { gameRoot, configPath, config };
}

export function gamePath(gameRoot, value) {
  if (!value) return undefined;
  return resolve(gameRoot, value);
}

export function requireSection(config, name) {
  const section = config[name];
  if (!section || section.enabled === false) return null;
  return section;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    ...options,
  });
  if (result.error) {
    throw new Error(`Failed to launch ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? 1}`);
  }
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

export function cliValue(name, fallback) {
  return argValue(name) ?? fallback;
}
