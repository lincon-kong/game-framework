import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gamePath, loadGameConfig, requireSection, run } from "../lib/game-config.mjs";
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

  const temp = mkdtempSync(join(tmpdir(), "game-framework-proto-"));
  try {
    run("protoc", [
      "-I", source,
      "--include_imports",
      "--descriptor_set_out", join(temp, "schema.pb"),
      ...protos,
    ], { cwd: gameRoot });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`Protobuf validated: ${protos.length} file(s)`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
