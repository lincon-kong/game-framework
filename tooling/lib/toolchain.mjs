import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export function sharedNodeRoot() {
  const pb = toolchain.protobuf;
  const st = toolchain.spacetime;
  return resolve(
    toolHome(),
    "node",
    `st-${st.typescriptSdkVersion}_tsproto-${pb.tsProto}_grpc-${pb.grpcTools}_buf-${pb.bufbuildProtobuf}_7zip-${pb.sevenZipBin}`,
  );
}

export function protobufNodeRoot() {
  return sharedNodeRoot();
}

export function protobufNodeBin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const path = resolve(sharedNodeRoot(), "node_modules", ".bin", executable);
  if (!existsSync(path)) {
    throw new Error(`Framework Node tool is not installed: ${path}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}

function packagePath(root, packageName) {
  return resolve(root, "node_modules", ...packageName.split("/"));
}

export function sharedNodePackage(packageName) {
  const path = packagePath(sharedNodeRoot(), packageName);
  if (!existsSync(path)) {
    throw new Error(`Framework Node runtime package is not installed: ${packageName}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}

function expectedPackageVersion(packageName) {
  if (packageName === "spacetimedb") return toolchain.spacetime.typescriptSdkVersion;
  if (packageName === "@bufbuild/protobuf") return toolchain.protobuf.bufbuildProtobuf;
  return undefined;
}

function packageVersion(path) {
  const file = resolve(path, "package.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")).version;
}

export function ensureGameNodePackageLink(gameRoot, packageName) {
  const target = sharedNodePackage(packageName);
  const link = packagePath(gameRoot, packageName);
  const expected = expectedPackageVersion(packageName);

  if (existsSync(link)) {
    const actual = packageVersion(link);
    if (expected && actual !== expected) {
      throw new Error(`Game has ${packageName}@${actual ?? "unknown"}, but Framework requires ${expected}. Remove the game-managed package and rerun generation.`);
    }
    return link;
  }

  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  return link;
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
