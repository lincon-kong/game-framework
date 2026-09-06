import { join } from "node:path";
import { run, toolingRoot } from "../lib/game-config.mjs";

const forwarded = process.argv.slice(2);

try {
  run(process.execPath, [join(toolingRoot, "luban", "generate.mjs"), ...forwarded]);
  run(process.execPath, [join(toolingRoot, "protobuf", "generate.mjs"), ...forwarded]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
