import {
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
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  protobufNodeRoot,
  toolHome,
  toolchain,
  toolingRoot,
} from "./lib/toolchain.mjs";

function run(command, args, cwd = toolingRoot, env = process.env) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false, env });
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
  const bufRuntime = resolve(root, "node_modules", "@bufbuild", "protobuf", "package.json");
  if (existsSync(marker) && existsSync(bufRuntime)) return root;

  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ name: "game-framework-shared-tools", private: true }, null, 2));

  const pb = toolchain.protobuf;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, [
    "install",
    "--no-save",
    `7zip-bin@${pb.sevenZipBin}`,
    `grpc-tools@${pb.grpcTools}`,
    `ts-proto@${pb.tsProto}`,
    `@bufbuild/protobuf@${pb.bufbuildProtobuf}`,
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

function ensureGoProtobufCodegen() {
  const version = toolchain.protobuf.protocGenGo;
  const bin = resolve(toolHome(), "protobuf", "go", `protoc-gen-go-${version}`, "bin");
  const executable = resolve(bin, process.platform === "win32" ? "protoc-gen-go.exe" : "protoc-gen-go");
  if (existsSync(executable)) return;

  mkdirSync(bin, { recursive: true });
  run(
    "go",
    ["install", `google.golang.org/protobuf/cmd/protoc-gen-go@v${version}`],
    toolingRoot,
    { ...process.env, GOBIN: bin },
  );
  if (!existsSync(executable)) throw new Error(`go install did not produce ${executable}`);
}

try {
  mkdirSync(toolHome(), { recursive: true });
  const nodeRoot = ensureNodeTools();
  await ensureLuban(sevenZipExecutable(nodeRoot));
  ensureGoProtobufCodegen();
  console.log(`Framework shared toolchain installed at: ${toolHome()}`);
  console.log(`Luban ${toolchain.luban.version}; ts-proto ${toolchain.protobuf.tsProto}; protoc-gen-go ${toolchain.protobuf.protocGenGo}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
