# Framework Tooling

Shared build/code-generation toolchain used by all game repositories.

## Ownership rule

**Framework owns tool dependencies and their versions. Games own only concrete schemas/data/module source and output paths.**

`tooling/toolchain.json` is the single version authority.

## Install once per machine

Do not install the toolchain inside every game or every Framework checkout.

Run once on a development machine:

```bash
node framework/tooling/install.mjs
```

Default shared install root:

```text
~/.game-framework/tools/
├── luban/<version>/
│   ├── Luban/
│   └── LICENSE
├── spacetime/<version>/<platform>/
│   └── spacetime[.exe]
├── node/<version-set>/
│   └── node_modules/
│       ├── spacetimedb
│       ├── @bufbuild/protobuf
│       ├── ts-proto
│       ├── grpc-tools
│       └── 7zip-bin
└── protobuf/rust/<version-set>/
    └── bin/game-framework-protobuf-rust-codegen[.exe]
```

Override the root only when needed:

```text
GAME_FRAMEWORK_TOOL_HOME=/custom/path
```

The installer is idempotent. If the pinned version is already present, it is reused. When a future Framework version pins newer tools, the new versions are installed side-by-side, so older games can keep using the toolchain pinned by their Framework commit.

`bootstrap.mjs` remains only as a compatibility alias to `install.mjs`.

## Current pinned baseline

- Luban `4.10.2`;
- SpacetimeDB CLI `2.8.3`;
- SpacetimeDB Rust module SDK `2.8.3`;
- SpacetimeDB TypeScript SDK `2.8.3`;
- ts-proto `2.12.1`;
- @bufbuild/protobuf `2.10.2`;
- grpc-tools/protoc `1.13.1`;
- prost-build `0.14.4`;
- protoc-bin-vendored `3.2.0`.

Luban and SpacetimeDB release downloads are checksum-validated before installation.

## Per-game configuration

Each game owns one root `game-tools.json`, based on `tooling/game-tools.example.json`.

It only describes:

- game SpacetimeDB module path/database/binding outputs;
- game Luban config/output paths;
- game `.proto` source and TS/Rust output paths.

It does not select tool versions and does not point at game-local tool binaries.

## Runtime dependency linking

Generated TypeScript can require runtime npm packages. Those packages are installed once into the shared tool home.

Framework generation automatically creates lightweight links in the consuming game's `node_modules` when required:

```text
SpacetimeDB TS bindings -> shared spacetimedb package
PB TS output            -> shared @bufbuild/protobuf package
```

This is linking, not a per-game install. If the game already contains a different version, generation fails instead of silently accepting version drift.

## Unified game commands

From a consuming game root:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Disabled sections in `game-tools.json` are skipped.

### SpacetimeDB

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs dev
node framework/tooling/spacetime/run.mjs publish --database my-game --server local
```

These always use the Framework-pinned CLI from the shared tool home.

### Luban

Games own only `luban.conf`, schemas/spreadsheets and content. Framework uses the shared Luban installation and emits the BounceBall-proven layout:

```text
<outputRoot>/typescript-bin
<outputRoot>/rust-bin
<outputRoot>/bin
```

TypeScript and Rust readers consume the same binary data set.

### Protobuf

One game-owned `.proto` source tree generates both sides:

```text
.proto
  ├── TypeScript via shared protoc + ts-proto
  └── Rust via shared compiled prost-build generator
```

No system `protoc`, no per-game `npm install`, and no repeated Rust codegen build are required after the machine-level installer has completed.

PB is only for explicit independent protocol boundaries. Normal SpacetimeDB reducer/subscription interaction uses generated SpacetimeDB bindings directly.
