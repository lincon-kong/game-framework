import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  platformKey,
  protobufNodeRoot,
  toolHome,
  toolchain,
  toolingRoot,
} from "./lib/toolchain.mjs";

function run(command, args, cwd = toolingRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function download(url, destination, expectedSha256) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedSha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha256) {
      throw new Error(`SHA-256 mismatch for ${url}\nexpected: ${expectedSha256}\nactual:   ${actual}`);
    }
  }
  mkdirSync(dirname(destination), { recursive: true });
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

function ensureNodeTools() {
  const root = protobufNodeRoot();
  const marker = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "grpc_tools_node_protoc.cmd" : "grpc_tools_node_protoc");
  if (existsSync(marker)) return root;

  mkdirSync(root, { recursive: true });
  const packageJson = resolve(root, "package.json");
  writeFileSync(packageJson, JSON.stringify({ name: "game-framework-shared-tools", private: true }, null, 2));

  const pb = toolchain.protobuf;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, [
    "install",
    "--no-save",
    `7zip-bin@${pb.sevenZipBin}`,
    `grpc-tools@${pb.grpcTools}`,
    `ts-proto@${pb.tsProto}`,
  ], root);
  return root;
}

function sevenZipExecutable(nodeRoot) {
  const require = createRequire(resolve(nodeRoot, "package.json"));
  const pkg = require("7zip-bin");
  if (!pkg.path7za) throw new Error("7zip-bin did not expose path7za");
  return pkg.path7za;
}

async function ensureLuban(sevenZip) {
  const version = toolchain.luban.version;
  const root = resolve(toolHome(), "luban", version);
  const dll = resolve(root, "Luban", "Luban.dll");
  if (existsSync(dll)) return;

  const temp = mkdtempSync(join(tmpdir(), "game-framework-luban-"));
  try {
    const archive = join(temp, "Luban.7z");
    await download(
      `https://github.com/focus-creative-games/luban/releases/download/v${version}/Luban.7z`,
      archive,
      toolchain.luban.archiveSha256,
    );
    const extracted = join(temp, "extracted");
    mkdirSync(extracted, { recursive: true });
    run(sevenZip, ["x", archive, `-o${extracted}`, "-y"]);

    const sourceDll = findFile(extracted, "Luban.dll");
    if (!sourceDll) throw new Error(`Luban ${version} archive did not contain Luban.dll`);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    cpSync(dirname(sourceDll), resolve(root, "Luban"), { recursive: true });
    await download(
      `https://raw.githubusercontent.com/focus-creative-games/luban/v${version}/LICENSE`,
      resolve(root, "LICENSE"),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function spacetimeAsset(version) {
  const assets = {
    "darwin-arm64": "spacetime-aarch64-apple-darwin.tar.gz",
    "darwin-x64": "spacetime-x86_64-apple-darwin.tar.gz",
    "linux-arm64": "spacetime-aarch64-unknown-linux-gnu.tar.gz",
    "linux-x64": "spacetime-x86_64-unknown-linux-gnu.tar.gz",
    "win32-x64": "spacetime-x86_64-pc-windows-msvc.zip",
  };
  const asset = assets[platformKey()];
  if (!asset) throw new Error(`SpacetimeDB ${version} installer does not support ${platformKey()}`);
  return asset;
}

async function ensureSpacetime(sevenZip) {
  const version = toolchain.spacetime.cliVersion;
  const executableName = process.platform === "win32" ? "spacetime.exe" : "spacetime";
  const root = resolve(toolHome(), "spacetime", version);
  const targetDir = resolve(root, platformKey());
  const target = resolve(targetDir, executableName);

  if (!existsSync(target)) {
    const asset = spacetimeAsset(version);
    const expectedSha256 = toolchain.spacetime.archiveSha256?.[platformKey()];
    if (!expectedSha256) throw new Error(`Missing SpacetimeDB checksum for ${platformKey()}`);

    const temp = mkdtempSync(join(tmpdir(), "game-framework-spacetime-"));
    try {
      const archive = join(temp, basename(asset));
      await download(
        `https://github.com/clockworklabs/SpacetimeDB/releases/download/v${version}/${asset}`,
        archive,
        expectedSha256,
      );
      const extracted = join(temp, "extracted");
      mkdirSync(extracted, { recursive: true });
      if (asset.endsWith(".zip")) {
        run(sevenZip, ["x", archive, `-o${extracted}`, "-y"]);
      } else {
        run("tar", ["-xzf", archive, "-C", extracted]);
      }
      const binary = findFile(extracted, executableName);
      if (!binary) throw new Error(`SpacetimeDB ${version} archive did not contain ${executableName}`);
      mkdirSync(targetDir, { recursive: true });
      copyFileSync(binary, target);
      if (process.platform !== "win32") chmodSync(target, 0o755);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }

  const license = resolve(root, "LICENSE.txt");
  if (!existsSync(license)) {
    await download(
      `https://raw.githubusercontent.com/clockworklabs/SpacetimeDB/v${version}/LICENSE.txt`,
      license,
    );
  }
}

function ensureRustCodegen() {
  const pb = toolchain.protobuf;
  const root = resolve(toolHome(), "protobuf", "rust", `prost-${pb.prostBuild}_protoc-${pb.protocBinVendored}`);
  const executableName = process.platform === "win32"
    ? "game-framework-protobuf-rust-codegen.exe"
    : "game-framework-protobuf-rust-codegen";
  const target = resolve(root, "bin", executableName);
  if (existsSync(target)) return;

  const targetDir = resolve(root, "target");
  const manifest = resolve(toolingRoot, "protobuf", "rust-codegen", "Cargo.toml");
  run("cargo", ["build", "--release", "--manifest-path", manifest, "--target-dir", targetDir]);

  const built = resolve(targetDir, "release", executableName);
  if (!existsSync(built)) throw new Error(`Rust Protobuf codegen build did not produce ${built}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(built, target);
  if (process.platform !== "win32") chmodSync(target, 0o755);
}

try {
  mkdirSync(toolHome(), { recursive: true });
  const nodeRoot = ensureNodeTools();
  const sevenZip = sevenZipExecutable(nodeRoot);
  await ensureLuban(sevenZip);
  await ensureSpacetime(sevenZip);
  ensureRustCodegen();
  console.log(`Framework shared toolchain installed at: ${toolHome()}`);
  console.log(`Luban ${toolchain.luban.version}; SpacetimeDB ${toolchain.spacetime.cliVersion}; ts-proto ${toolchain.protobuf.tsProto}; prost-build ${toolchain.protobuf.prostBuild}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
