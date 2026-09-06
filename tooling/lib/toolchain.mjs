import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const toolingRoot = resolve(here, "..");
export const frameworkRoot = resolve(toolingRoot, "..");
export const toolchainPath = resolve(toolingRoot, "toolchain.json");
export const toolchain = JSON.parse(readFileSync(toolchainPath, "utf8"));

export function toolHome() {
  return resolve(process.env.GAME_FRAMEWORK_TOOL_HOME ?? join(homedir(), ".game-framework", "tools"));
}

export function lubanRoot() {
  return resolve(toolingRoot, "luban", "vendor");
}

export function lubanDll() {
  const path = resolve(lubanRoot(), "Luban", "Luban.dll");
  if (!existsSync(path)) {
    throw new Error(`Committed Luban ${toolchain.luban.version} is missing: ${path}. Restore/update the game-framework checkout.`);
  }
  return path;
}

export function sharedNodeRoot() {
  const pb = toolchain.protobuf;
  return resolve(
    toolHome(),
    "node",
    `tsproto-${pb.tsProto}_grpc-${pb.grpcTools}_buf-${pb.bufbuildProtobuf}`,
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

export function protobufGoCodegenExecutable() {
  const version = toolchain.protobuf.protocGenGo;
  const executable = process.platform === "win32" ? "protoc-gen-go.exe" : "protoc-gen-go";
  const path = resolve(toolHome(), "protobuf", "go", `protoc-gen-go-${version}`, "bin", executable);
  if (!existsSync(path)) {
    throw new Error(`Framework protoc-gen-go ${version} is not installed: ${path}. Run: node framework/tooling/install.mjs`);
  }
  return path;
}
