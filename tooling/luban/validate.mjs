import { loadGameConfig, requireSection } from "../lib/game-config.mjs";
import { loadLubanSource, resolveLubanDll } from "./lib.mjs";

try {
  const { gameRoot, config } = loadGameConfig();
  const section = requireSection(config, "luban");
  if (!section) {
    console.log("Luban: disabled");
    process.exit(0);
  }
  const { configPath } = loadLubanSource(gameRoot, section);
  const dll = resolveLubanDll(gameRoot, section);
  console.log(`Luban config: ${configPath}`);
  console.log(`Luban tool:   ${dll}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
