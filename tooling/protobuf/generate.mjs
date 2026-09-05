import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gamePath, loadGameConfig, requireSection, run, toolingRoot } from "../lib/game-config.mjs";
import { listProtoFiles } from "./lib.mjs";

function toolBin(name) {
  return join(toolingRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

try {
  const { gameRoot, config } = loadGameConfig();
  const section = requireSection(config, "protobuf");
  if (!section) {
    console.log("Protobuf: disabled");
    process.exit(0);
  }

  const source = gamePath(gameRoot, section.source ?? "shared/protocol");
  const protos = listProtoFiles(source);
  if (protos.length === 0) throw new Error(`No .proto files found under ${source}`);

  const protoc = toolBin("grpc_tools_node_protoc");
  const tsProto = toolBin("protoc-gen-ts_proto");
  if (!existsSync(protoc) || !existsSync(tsProto)) {
    throw new Error(`Framework Protobuf dependencies are missing. Run npm install in ${toolingRoot}`);
  }

  const typescriptOut = section.typescriptOut ? gamePath(gameRoot, section.typescriptOut) : undefined;
  if (typescriptOut) {
    rmSync(typescriptOut, { recursive: true, force: true });
    mkdirSync(typescriptOut, { recursive: true });
    run(protoc, [
      "-I", source,
      `--plugin=protoc-gen-ts_proto=${tsProto}`,
      `--ts_proto_out=${typescriptOut}`,
      "--ts_proto_opt=env=browser,forceLong=string,esModuleInterop=true,outputServices=none,useExactTypes=false",
      ...protos,
    ], { cwd: gameRoot });
  }

  const rustOut = section.rustOut ? gamePath(gameRoot, section.rustOut) : undefined;
  if (rustOut) {
    rmSync(rustOut, { recursive: true, force: true });
    mkdirSync(rustOut, { recursive: true });
    run("cargo", [
      "run", "--quiet",
      "--manifest-path", join(toolingRoot, "protobuf", "rust-codegen", "Cargo.toml"),
      "--",
      source,
      rustOut,
    ], { cwd: gameRoot });
  }

  console.log(`Protobuf generated: ${protos.length} source file(s)`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
