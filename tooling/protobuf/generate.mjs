import { mkdirSync, rmSync } from "node:fs";
import { gamePath, loadGameConfig, requireSection, run } from "../lib/game-config.mjs";
import {
  ensureGameNodePackageLink,
  protobufGoCodegenExecutable,
  protobufNodeBin,
} from "../lib/toolchain.mjs";
import { listProtoFiles } from "./lib.mjs";

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

  const protoc = protobufNodeBin("grpc_tools_node_protoc");
  const tsProto = protobufNodeBin("protoc-gen-ts_proto");

  const typescriptOut = section.typescriptOut ? gamePath(gameRoot, section.typescriptOut) : undefined;
  if (typescriptOut) {
    ensureGameNodePackageLink(gameRoot, "@bufbuild/protobuf");
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

  const goOut = section.goOut ? gamePath(gameRoot, section.goOut) : undefined;
  if (goOut) {
    const protocGenGo = protobufGoCodegenExecutable();
    rmSync(goOut, { recursive: true, force: true });
    mkdirSync(goOut, { recursive: true });
    run(protoc, [
      "-I", source,
      `--plugin=protoc-gen-go=${protocGenGo}`,
      `--go_out=${goOut}`,
      "--go_opt=paths=source_relative",
      ...protos,
    ], { cwd: gameRoot });
  }

  console.log(`Protobuf generated: ${protos.length} source file(s)`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
