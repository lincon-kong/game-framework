import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const toolingRoot = resolve(here, "..");
export const frameworkRoot = resolve(toolingRoot, "..");
export const toolchainPath = resolve(toolingRoot, "toolchain.json");
export const toolchain = JSON.parse(readFileSync(toolchainPath, "utf8"));

export function platformKey() {
  return `${process.platform}-${process.arch}`;
}

export function toolHome() {
  return resolve(process.env.GAME_FRAMEWORK_TOOL_HOME ?? join(homedir(), ".game-framework", "tools"));
}

export function lubanRoot() {
  return resolve(toolHome(), "luban", toolchain.luban.version);
}

export function lubanDll() {
  const path = resolve(lubanRoot(), "Luban", "Luban.dll");
  if (!existsSync(path)) {
    throw new Error(`Luban ${toolchain.luban.version} is not installed: ${path}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}

export function spacetimeExecutable() {
  const executable = process.platform === "win32" ? "spacetime.exe" : "spacetime";
  const path = resolve(toolHome(), "spacetime", toolchain.spacetime.cliVersion, platformKey(), executable);
  if (!existsSync(path)) {
    throw new Error(`SpacetimeDB CLI ${toolchain.spacetime.cliVersion} is not installed: ${path}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}

export function protobufNodeRoot() {
  const pb = toolchain.protobuf;
  return resolve(
    toolHome(),
    "protobuf",
    "node",
    `ts-proto-${pb.tsProto}_grpc-tools-${pb.grpcTools}_7zip-bin-${pb.sevenZipBin}`,
  );
}

export function protobufNodeBin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const path = resolve(protobufNodeRoot(), "node_modules", ".bin", executable);
  if (!existsSync(path)) {
    throw new Error(`Framework Protobuf Node tool is not installed: ${path}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}

export function protobufRustCodegenExecutable() {
  const pb = toolchain.protobuf;
  const executable = process.platform === "win32"
    ? "game-framework-protobuf-rust-codegen.exe"
    : "game-framework-protobuf-rust-codegen";
  const path = resolve(
    toolHome(),
    "protobuf",
    "rust",
    `prost-${pb.prostBuild}_protoc-${pb.protocBinVendored}`,
    "bin",
    executable,
  );
  if (!existsSync(path)) {
    throw new Error(`Framework Protobuf Rust codegen is not installed: ${path}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}
