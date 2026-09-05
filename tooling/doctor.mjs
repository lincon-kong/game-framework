import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  lubanDll,
  platformKey,
  protobufNodeBin,
  protobufRustCodegenExecutable,
  sharedNodePackage,
  spacetimeExecutable,
  toolHome,
  toolchain,
} from "./lib/toolchain.mjs";

const rows = [];
const jsonMode = process.argv.includes("--json");

function add(level, name, detail, fix) {
  rows.push({ level, name, detail, ...(fix ? { fix } : {}) });
}

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) return undefined;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split(/\r?\n/)[0];
}

function pathCandidates(command) {
  const pathValue = process.env.PATH ?? "";
  const directories = pathValue.split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  const hasExtension = Boolean(extname(command));
  const candidates = [];
  for (const directory of directories) {
    if (hasExtension) {
      const candidate = resolve(directory, command);
      if (existsSync(candidate)) candidates.push(candidate);
      continue;
    }
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension.toLowerCase()}`);
      const originalCase = resolve(directory, `${command}${extension}`);
      if (existsSync(candidate)) candidates.push(candidate);
      else if (candidate !== originalCase && existsSync(originalCase)) candidates.push(originalCase);
    }
  }
  return [...new Set(candidates)];
}

function packageVersion(packageRoot) {
  try {
    return JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

function semverMajor(value) {
  const match = `${value ?? ""}`.match(/(\d+)\./);
  return match ? Number(match[1]) : undefined;
}

function checkBaseCommand(name, args, minimumMajor) {
  const version = commandVersion(name, args);
  if (!version) {
    add("ERROR", name, "not available on PATH", `Install ${name} and ensure it is available to the shell.`);
    return;
  }
  if (minimumMajor !== undefined) {
    const major = semverMajor(version);
    if (major !== undefined && major < minimumMajor) {
      add("ERROR", name, version, `Framework requires ${name} major >= ${minimumMajor}.`);
      return;
    }
  }
  add("OK", name, version);
}

function checkWritableDirectory() {
  const root = toolHome();
  try {
    mkdirSync(root, { recursive: true });
    accessSync(root, constants.R_OK | constants.W_OK);
    const probe = resolve(root, `.doctor-${process.pid}`);
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    add("OK", "tool home", `${root} (read/write)`);
  } catch (error) {
    add("ERROR", "tool home", `${root}: ${error.message}`, "Set GAME_FRAMEWORK_TOOL_HOME to a writable user-level directory.");
  }
}

function checkJunctionOrSymlink() {
  const root = resolve(tmpdir(), `game-framework-doctor-${process.pid}`);
  const target = resolve(root, "target");
  const link = resolve(root, "link");
  try {
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    add("OK", process.platform === "win32" ? "junction" : "symlink", "supported");
  } catch (error) {
    add(
      "ERROR",
      process.platform === "win32" ? "junction" : "symlink",
      error.message,
      process.platform === "win32"
        ? "Ensure the user can create directory junctions on this filesystem."
        : "Ensure the user/filesystem permits symbolic links.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function checkDotnet() {
  const version = commandVersion("dotnet", ["--version"]);
  if (!version) {
    add("ERROR", ".NET", "dotnet not available on PATH", "Install .NET 8 runtime/SDK for Luban 4.10.2.");
    return;
  }

  const runtimes = spawnSync("dotnet", ["--list-runtimes"], { encoding: "utf8", shell: false });
  const text = runtimes.status === 0 ? runtimes.stdout ?? "" : "";
  if (!/Microsoft\.NETCore\.App 8\./.test(text)) {
    add("ERROR", ".NET", `${version}; .NET 8 runtime not found`, "Install Microsoft.NETCore.App 8.x for Luban 4.10.2.");
  } else {
    add("OK", ".NET", `${version}; .NET 8 runtime available`);
  }
}

function checkInstalledTools() {
  try {
    const path = lubanDll();
    const deps = resolve(dirname(path), "Luban.deps.json");
    const content = existsSync(deps) ? readFileSync(deps, "utf8") : "";
    if (content && !content.includes(`Luban/${toolchain.luban.version}`)) {
      add("ERROR", "Luban", `${path}; version metadata does not match ${toolchain.luban.version}`, "Re-run Framework installer.");
    } else {
      add("OK", "Luban", `${toolchain.luban.version} @ ${path}`);
    }
  } catch (error) {
    add("ERROR", "Luban", error.message, "Run: node framework/tooling/install.mjs");
  }

  try {
    const path = spacetimeExecutable();
    const version = commandVersion(path, ["--version"]);
    if (!version || !version.includes(toolchain.spacetime.cliVersion)) {
      add("ERROR", "SpacetimeDB CLI", `${version ?? "unreadable version"} @ ${path}`, "Re-run Framework installer.");
    } else {
      add("OK", "SpacetimeDB CLI", `${version} @ ${path}`);
    }
  } catch (error) {
    add("ERROR", "SpacetimeDB CLI", error.message, "Run: node framework/tooling/install.mjs");
  }

  const expectedPackages = [
    ["spacetimedb", toolchain.spacetime.typescriptSdkVersion],
    ["@bufbuild/protobuf", toolchain.protobuf.bufbuildProtobuf],
  ];
  for (const [name, expected] of expectedPackages) {
    try {
      const root = sharedNodePackage(name);
      const actual = packageVersion(root);
      if (actual !== expected) {
        add("ERROR", `Node package ${name}`, `${actual ?? "unknown"}; expected ${expected}`, "Re-run Framework installer.");
      } else {
        add("OK", `Node package ${name}`, `${actual} @ ${root}`);
      }
    } catch (error) {
      add("ERROR", `Node package ${name}`, error.message, "Run: node framework/tooling/install.mjs");
    }
  }

  const nodeBins = [
    ["PB protoc", "grpc_tools_node_protoc"],
    ["ts-proto", "protoc-gen-ts_proto"],
  ];
  for (const [label, name] of nodeBins) {
    try {
      add("OK", label, protobufNodeBin(name));
    } catch (error) {
      add("ERROR", label, error.message, "Run: node framework/tooling/install.mjs");
    }
  }

  try {
    add("OK", "PB Rust codegen", protobufRustCodegenExecutable());
  } catch (error) {
    add("ERROR", "PB Rust codegen", error.message, "Run: node framework/tooling/install.mjs");
  }
}

function checkEnvironmentOverrides() {
  const watched = [
    "GAME_FRAMEWORK_TOOL_HOME",
    "DOTNET_ROOT",
    "DOTNET_ROLL_FORWARD",
    "DOTNET_MULTILEVEL_LOOKUP",
    "RUSTUP_TOOLCHAIN",
    "CARGO_HOME",
    "NODE_OPTIONS",
    "NPM_CONFIG_PREFIX",
  ];

  const set = watched.filter(name => process.env[name]);
  if (set.length === 0) {
    add("OK", "environment overrides", "none of the watched overrides are set");
    return;
  }

  for (const name of set) {
    const value = process.env[name];
    const level = name === "GAME_FRAMEWORK_TOOL_HOME" ? "INFO" : "WARN";
    add(level, `env ${name}`, value, level === "WARN" ? "If tool behavior is unexpected, retry in a clean shell without this override." : undefined);
  }
}

function checkPathConflicts() {
  for (const command of ["spacetime", "protoc"]) {
    const found = pathCandidates(command);
    if (found.length > 0) {
      add(
        "INFO",
        `PATH ${command}`,
        found.join(" | "),
        "Framework uses its own absolute-path tool, so this does not affect normal Framework commands.",
      );
    } else {
      add("OK", `PATH ${command}`, "no global copy found");
    }
  }
}

add("OK", "platform", `${process.platform}/${process.arch} (${platformKey()})`);
checkWritableDirectory();
checkBaseCommand("node", ["--version"], 18);
checkBaseCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
checkDotnet();
checkBaseCommand("rustc", ["--version"]);
checkBaseCommand("cargo", ["--version"]);
checkJunctionOrSymlink();
checkEnvironmentOverrides();
checkPathConflicts();
checkInstalledTools();

const errors = rows.filter(row => row.level === "ERROR").length;
const warnings = rows.filter(row => row.level === "WARN").length;

if (jsonMode) {
  console.log(JSON.stringify({
    status: errors === 0 ? "READY" : "NOT_READY",
    errors,
    warnings,
    toolHome: toolHome(),
    checks: rows,
  }, null, 2));
} else {
  console.log("Game Framework Doctor");
  console.log(`Tool home: ${toolHome()}`);
  console.log("");
  for (const row of rows) {
    console.log(`[${row.level}] ${row.name}: ${row.detail}`);
    if (row.fix) console.log(`       ${row.fix}`);
  }
  console.log("");
  console.log(`Framework Toolchain: ${errors === 0 ? "READY" : "NOT READY"} (${errors} error(s), ${warnings} warning(s))`);
}

process.exitCode = errors === 0 ? 0 : 1;
