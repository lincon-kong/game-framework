import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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

function ensureNodeTools() {
  const root = protobufNodeRoot();
  const marker = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "grpc_tools_node_protoc.cmd" : "grpc_tools_node_protoc");
  const bufRuntime = resolve(root, "node_modules", "@bufbuild", "protobuf", "package.json");
  if (existsSync(marker) && existsSync(bufRuntime)) return root;

  const pb = toolchain.protobuf;
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, "package.json"), JSON.stringify({
    name: "game-framework-shared-tools",
    private: true,
    allowScripts: {
      [`grpc-tools@${pb.grpcTools}`]: true,
    },
  }, null, 2));

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, [
    "install",
    "--no-save",
    `grpc-tools@${pb.grpcTools}`,
    `ts-proto@${pb.tsProto}`,
    `@bufbuild/protobuf@${pb.bufbuildProtobuf}`,
  ], root);
  return root;
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
  ensureNodeTools();
  ensureGoProtobufCodegen();
  console.log(`Framework generated-code tools ready at: ${toolHome()}`);
  console.log(`Luban ${toolchain.luban.version} is committed in Framework; ts-proto ${toolchain.protobuf.tsProto}; protoc-gen-go ${toolchain.protobuf.protocGenGo}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
