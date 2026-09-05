# Framework Tooling

Shared build/code-generation toolchain used by all game repositories.

## Ownership rule

**Framework owns tool dependencies and their versions. Games own only input schemas/data and output paths.**

```text
game-framework/
└── tooling/
    ├── toolchain.json          pinned tool versions
    ├── bootstrap.mjs           installs Framework-owned tools
    ├── package.json            Node/codegen dependencies
    ├── luban/                  Luban distribution + wrapper
    ├── spacetime/              SpacetimeDB CLI + wrapper
    ├── protobuf/               protoc/ts-proto/prost codegen
    └── scripts/                aggregate commands
```

A game must not carry its own Luban runtime, protoc, ts-proto, prost-build tool crate or SpacetimeDB CLI version.

## Pinned baseline

`tooling/toolchain.json` is the authority for external tool versions.

Current baseline:

- Luban `4.10.2`;
- SpacetimeDB CLI `2.10.0`;
- ts-proto `2.12.1`;
- grpc-tools/protoc `1.13.1`;
- prost-build `0.14.4`;
- protoc-bin-vendored `3.2.0`.

Do not upgrade one consuming game independently. Upgrade Framework, validate against consumers, then move the game's Framework commit when desired.

## Bootstrap

From the Framework tooling directory or from a consuming game submodule:

```bash
node framework/tooling/bootstrap.mjs
```

The bootstrap installs/downloads dependencies into the Framework tree:

```text
framework/tooling/node_modules/
framework/tooling/luban/Luban/
framework/tooling/luban/LICENSE
framework/tooling/spacetime/bin/<platform>-<arch>/
```

The game repository does not own these files.

Framework Git may later choose to commit selected vendored binary distributions for fully offline/reproducible builds. The ownership rule remains the same either way.

## Per-game configuration

Each game owns only root `game-tools.json`, based on `tooling/game-tools.example.json`.

It describes:

- where the game's SpacetimeDB module source lives;
- where generated SpacetimeDB bindings should be written;
- where the game's `luban.conf` and generated outputs live;
- where game `.proto` source and generated TS/Rust files live.

It does **not** select tool versions or point to game-local tool binaries.

## Unified commands

Run from the consuming game root:

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

These commands use the Framework-local pinned SpacetimeDB CLI, never a game-local/global CLI by default.

Generated bindings are the direct typed client contract; do not wrap normal reducer/subscription interaction in duplicate PB RPC.

### Luban

The Framework owns the full Luban distribution and dependencies under:

```text
framework/tooling/luban/Luban/
```

Games own only `luban.conf`, schemas/spreadsheets and content.

Standard output follows the BounceBall-proven model:

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
  ├── TypeScript via Framework ts-proto + Framework-owned protoc
  └── Rust via Framework prost-build + protoc-bin-vendored
```

No system protoc installation and no game-local PB generator dependencies are required.

PB is only for explicit independent protocol boundaries. Direct SpacetimeDB client interactions use SpacetimeDB generated bindings instead.
