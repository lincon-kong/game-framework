import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { platformKey, toolchain, toolingRoot } from "./lib/toolchain.mjs";

function run(command, args, cwd = toolingRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, bytes);
}

function findFile(root, name) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry === name) {
      return path;
    }
  }
  return undefined;
}

async function ensureNodeDependencies() {
  const marker = resolve(toolingRoot, "node_modules", ".bin", process.platform === "win32" ? "grpc_tools_node_protoc.cmd" : "grpc_tools_node_protoc");
  if (existsSync(marker)) return;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["install"], toolingRoot);
}

async function sevenZipExecutable() {
  const module = await import("7zip-bin");
  const value = module.default ?? module;
  if (!value.path7za) throw new Error("7zip-bin did not expose path7za");
  return value.path7za;
}

async function ensureLuban() {
  const target = resolve(toolingRoot, "luban", "Luban", "Luban.dll");
  if (existsSync(target)) return;

  const version = toolchain.luban.version;
  const temp = mkdtempSync(join(tmpdir(), "game-framework-luban-"));
  try {
    const archive = join(temp, "Luban.7z");
    await download(`https://github.com/focus-creative-games/luban/releases/download/v${version}/Luban.7z`, archive);
    const extracted = join(temp, "extracted");
    mkdirSync(extracted, { recursive: true });
    run(await sevenZipExecutable(), ["x", archive, `-o${extracted}`, "-y"]);

    const dll = findFile(extracted, "Luban.dll");
    if (!dll) throw new Error(`Luban ${version} archive did not contain Luban.dll`);

    const targetDir = resolve(toolingRoot, "luban", "Luban");
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(dirname(dll), targetDir, { recursive: true });

    const license = resolve(toolingRoot, "luban", "LICENSE");
    await download(`https://raw.githubusercontent.com/focus-creative-games/luban/v${version}/LICENSE`, license);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function spacetimeAsset(version) {
  const assets = {
    "darwin-arm64": `spacetime-aarch64-apple-darwin.tar.gz`,
    "darwin-x64": `spacetime-x86_64-apple-darwin.tar.gz`,
    "linux-arm64": `spacetime-aarch64-unknown-linux-gnu.tar.gz`,
    "linux-x64": `spacetime-x86_64-unknown-linux-gnu.tar.gz`,
    "win32-x64": `spacetime-x86_64-pc-windows-msvc.zip`,
  };
  const asset = assets[platformKey()];
  if (!asset) throw new Error(`SpacetimeDB ${version} bootstrap does not support ${platformKey()}`);
  return asset;
}

async function ensureSpacetime() {
  const executableName = process.platform === "win32" ? "spacetime.exe" : "spacetime";
  const targetDir = resolve(toolingRoot, "spacetime", "bin", platformKey());
  const target = resolve(targetDir, executableName);
  if (existsSync(target)) return;

  const version = toolchain.spacetime.version;
  const asset = spacetimeAsset(version);
  const temp = mkdtempSync(join(tmpdir(), "game-framework-spacetime-"));
  try {
    const archive = join(temp, basename(asset));
    await download(`https://github.com/clockworklabs/SpacetimeDB/releases/download/v${version}/${asset}`, archive);
    const extracted = join(temp, "extracted");
    mkdirSync(extracted, { recursive: true });

    if (asset.endsWith(".zip")) {
      run(await sevenZipExecutable(), ["x", archive, `-o${extracted}`, "-y"]);
    } else {
      run("tar", ["-xzf", archive, "-C", extracted]);
    }

    const binary = findFile(extracted, executableName);
    if (!binary) throw new Error(`SpacetimeDB ${version} archive did not contain ${executableName}`);

    mkdirSync(targetDir, { recursive: true });
    cpSync(binary, target);
    if (process.platform !== "win32") chmodSync(target, 0o755);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  await ensureNodeDependencies();
  await ensureLuban();
  await ensureSpacetime();
  console.log(`Framework toolchain ready: Luban ${toolchain.luban.version}, SpacetimeDB ${toolchain.spacetime.version}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
