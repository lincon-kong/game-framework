import { closeSync, mkdirSync, openSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { gamePath, loadGameConfig, requireSection, run } from "../lib/game-config.mjs";
import { loadLubanSource, resolveLubanDll } from "./lib.mjs";

let lockHandle;
let lockPath;

try {
  const { gameRoot, config } = loadGameConfig();
  const section = requireSection(config, "luban");
  if (!section) {
    console.log("Luban: disabled");
    process.exit(0);
  }

  const { configPath } = loadLubanSource(gameRoot, section);
  const lubanDll = resolveLubanDll(gameRoot, section);
  const generatedRoot = gamePath(gameRoot, section.outputRoot ?? "data/generated");
  const typescriptOutput = join(generatedRoot, "typescript-bin");
  const rustOutput = join(generatedRoot, "rust-bin");
  const binaryOutput = join(generatedRoot, "bin");

  mkdirSync(generatedRoot, { recursive: true });
  lockPath = join(generatedRoot, ".generate.lock");
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      lockHandle = openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }

  for (const directory of [typescriptOutput, rustOutput, binaryOutput]) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
  }

  const target = section.target ?? "all";
  run("dotnet", [
    lubanDll,
    "--conf", configPath,
    "-t", target,
    "-c", "typescript-bin",
    "-c", "rust-bin",
    "-d", "bin",
    "-x", `typescript-bin.outputCodeDir=${typescriptOutput}`,
    "-x", `rust-bin.outputCodeDir=${rustOutput}`,
    "-x", `bin.outputDataDir=${binaryOutput}`,
  ], { cwd: gameRoot });

  console.log(`Luban generated: ${generatedRoot}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (lockHandle !== undefined) closeSync(lockHandle);
  if (lockPath) {
    try { unlinkSync(lockPath); } catch {}
  }
}
