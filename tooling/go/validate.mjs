import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { gamePath, loadGameConfig, requireSection, run } from "../lib/game-config.mjs";

try {
  const { gameRoot, config } = loadGameConfig();
  const section = requireSection(config, "server");
  if (!section) {
    console.log("Go server: disabled");
    process.exit(0);
  }

  const moduleRoot = gamePath(gameRoot, section.modulePath ?? "server");
  const goMod = resolve(moduleRoot, "go.mod");
  if (!existsSync(goMod)) throw new Error(`Go server module is enabled but missing: ${goMod}`);

  run("go", ["test", "./..."], { cwd: moduleRoot });
  console.log(`Go server validated: ${moduleRoot}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
