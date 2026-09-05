import { mkdirSync, rmSync } from "node:fs";
import { relative } from "node:path";
import { cliValue, gamePath, hasFlag, loadGameConfig, requireSection, run } from "../lib/game-config.mjs";

const action = process.argv[2];
if (!action || !["build", "generate", "publish", "dev"].includes(action)) {
  console.error("Usage: node tooling/spacetime/run.mjs <build|generate|publish|dev> [--game-root DIR] [--database NAME] [--server NAME] [--yes]");
  process.exit(1);
}

try {
  const { gameRoot, config } = loadGameConfig();
  const section = requireSection(config, "spacetime");
  if (!section) {
    console.log("SpacetimeDB: disabled");
    process.exit(0);
  }

  const modulePath = gamePath(gameRoot, section.modulePath ?? "server/spacetime");

  if (action === "build") {
    run("spacetime", ["build", "--module-path", modulePath], { cwd: gameRoot });
  }

  if (action === "generate") {
    const bindings = section.bindings ?? {};
    for (const [language, output] of Object.entries(bindings)) {
      if (!output) continue;
      const outDir = gamePath(gameRoot, output);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      run("spacetime", [
        "generate",
        "--lang", language,
        "--out-dir", outDir,
        "--module-path", modulePath,
      ], { cwd: gameRoot });
    }
  }

  if (action === "publish") {
    const database = cliValue("--database", section.database);
    if (!database) throw new Error("SpacetimeDB publish requires database in game-tools.json or --database");
    const server = cliValue("--server", section.server);
    const args = ["publish", database, "--module-path", modulePath];
    if (server) args.push("--server", server);
    if (hasFlag("--yes")) args.push("--yes");
    run("spacetime", args, { cwd: gameRoot });
  }

  if (action === "dev") {
    const database = cliValue("--database", section.database);
    const server = cliValue("--server", section.server);
    const args = ["dev"];
    if (database) args.push(database);
    args.push("--project-path", gameRoot, "--module-path", modulePath);
    const tsOutput = section.bindings?.typescript;
    if (tsOutput) {
      args.push("--client-lang", "typescript");
      args.push("--module-bindings-path", relative(gameRoot, gamePath(gameRoot, tsOutput)));
    }
    if (server) args.push("--server", server);
    run("spacetime", args, { cwd: gameRoot });
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
