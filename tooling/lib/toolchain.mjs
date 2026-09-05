import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const toolingRoot = resolve(here, "..");
export const toolchainPath = resolve(toolingRoot, "toolchain.json");
export const toolchain = JSON.parse(readFileSync(toolchainPath, "utf8"));

export function platformKey() {
  return `${process.platform}-${process.arch}`;
}

export function spacetimeExecutable() {
  const executable = process.platform === "win32" ? "spacetime.exe" : "spacetime";
  const path = resolve(toolingRoot, "spacetime", "bin", platformKey(), executable);
  if (!existsSync(path)) {
    throw new Error(`Framework-owned SpacetimeDB CLI is missing: ${path}. Run: node framework/tooling/bootstrap.mjs`);
  }
  return path;
}

export function lubanDll() {
  const path = resolve(toolingRoot, "luban", "Luban", "Luban.dll");
  if (!existsSync(path)) {
    throw new Error(`Framework-owned Luban distribution is missing: ${path}. Run: node framework/tooling/bootstrap.mjs`);
  }
  return path;
}
