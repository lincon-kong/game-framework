import { closeSync, mkdirSync, openSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { gamePath, loadGameConfig, requireSection, run } from "../lib/game-config.mjs";
import { loadLubanSource, resolveLubanDll } from "./lib.mjs";

const codeTargets = new Map([
  ["typescript", "typescript-bin"],
  ["go", "go-bin"],
  ["rust", "rust-bin"],
]);

let lockHandle;
let lockPath;

try {
  const { gameRoot, config } = loadGameConfig();
  const section = requireSection(config, "luban");
  if (!section) {
    console.log("Luban: disabled");
    process.exit(0);
  }

  const languages = section.languages ?? ["typescript", "go"];
  if (!Array.isArray(languages) || languages.length === 0) throw new Error("Luban languages must be a non-empty array");
  const uniqueLanguages = [...new Set(languages)];
  for (const language of uniqueLanguages) {
    if (!codeTargets.has(language)) throw new Error(`Unsupported Luban language: ${language}`);
  }
  if (uniqueLanguages.includes("go") && !section.goModule) {
    throw new Error("Luban Go generation requires luban.goModule in game-tools.json");
  }

  const { configPath } = loadLubanSource(gameRoot, section);
  const lubanDll = resolveLubanDll(gameRoot, section);
  const generatedRoot = gamePath(gameRoot, section.outputRoot ?? "data/generated");
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

  rmSync(binaryOutput, { recursive: true, force: true });
  mkdirSync(binaryOutput, { recursive: true });

  const args = [lubanDll, "--conf", configPath, "-t", section.target ?? "all"];
  for (const language of uniqueLanguages) {
    const codeTarget = codeTargets.get(language);
    const output = join(generatedRoot, codeTarget);
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
    args.push("-c", codeTarget, "-x", `${codeTarget}.outputCodeDir=${output}`);
    if (language === "go") args.push("-x", `${codeTarget}.lubanGoModule=${section.goModule}`);
  }
  args.push("-d", "bin", "-x", `bin.outputDataDir=${binaryOutput}`);

  run("dotnet", args, { cwd: gameRoot });
  console.log(`Luban generated: ${generatedRoot} (${uniqueLanguages.join(", ")})`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (lockHandle !== undefined) closeSync(lockHandle);
  if (lockPath) {
    try { unlinkSync(lockPath); } catch {}
  }
}
