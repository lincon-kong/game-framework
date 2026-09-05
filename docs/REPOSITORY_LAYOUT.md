# Repository Layout

This document defines the target directory layout and ownership rules for `game-framework`.

## 1. Framework repository

```text
game-framework/
├── AGENTS.md
├── README.md
├── client/
│   ├── src/
│   ├── tests/
│   └── README.md
├── server/
│   ├── spacetime/
│   │   ├── Cargo.toml
│   │   ├── src/lib.rs
│   │   └── README.md
│   ├── native/                  # only when a real game needs it
│   └── README.md
├── tooling/
│   ├── toolchain.json           # version/checksum authority
│   ├── install.mjs              # machine-level shared installer
│   ├── bootstrap.mjs            # compatibility alias
│   ├── package.json
│   ├── game-tools.example.json
│   ├── lib/
│   │   ├── game-config.mjs
│   │   └── toolchain.mjs
│   ├── spacetime/
│   │   ├── run.mjs
│   │   └── README.md
│   ├── luban/
│   │   ├── lib.mjs
│   │   ├── validate.mjs
│   │   ├── generate.mjs
│   │   └── README.md
│   ├── protobuf/
│   │   ├── lib.mjs
│   │   ├── validate.mjs
│   │   ├── generate.mjs
│   │   ├── rust-codegen/
│   │   └── README.md
│   ├── scripts/
│   │   ├── generate-all.mjs
│   │   └── validate-all.mjs
│   └── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── CLIENT.md
    ├── SERVER.md
    ├── REPOSITORY_LAYOUT.md
    └── DEVELOPMENT.md
```

External tool binaries are intentionally not duplicated in each Framework checkout.

## 2. Shared machine-level tool home

`tooling/install.mjs` installs the Framework-pinned toolchain once per machine.

Default:

```text
~/.game-framework/tools/
├── luban/<version>/
│   ├── Luban/
│   └── LICENSE
├── spacetime/<version>/<platform>/
│   └── spacetime[.exe]
├── node/<version-set>/
│   └── node_modules/
└── protobuf/rust/<version-set>/
    └── bin/game-framework-protobuf-rust-codegen[.exe]
```

`GAME_FRAMEWORK_TOOL_HOME` may override the root.

Different games and different Framework checkouts reuse the same installed version directories. New versions are installed side-by-side.

## 3. Root ownership

### `README.md`
Repository entry point and documentation index.

### `AGENTS.md`
Mandatory rules for humans/Codex/automated contributors.

### `docs/`
Long-lived architecture authority. Do not store temporary task plans/status logs here.

## 4. Client ownership

`client/` contains reusable TypeScript/Laya runtime mechanisms only: lifecycle, asset/package/router/UI/event/timer/update/pool/entity/FSM/module/network/storage/log/crash/performance/WASM/error/Laya integration and focused tests.

Concrete game routes, UI, controllers, models, assets, APIs and gameplay remain game-owned.

## 5. Server ownership

### `server/spacetime/`
Reusable Rust crate for the default **direct SpacetimeDB** backend model.

It owns the Framework-supported Rust SpacetimeDB SDK baseline and reusable helpers/types. It is not an Adapter/Repository/Port abstraction.

Concrete player/inventory/quest/economy/stage/battle tables and reducers stay in the game repository.

### `server/native/`
Reserved for native Rust server foundations only when a real consumer requires dedicated process/realtime behavior.

There is intentionally no baseline persistence Adapter/Repository layer.

## 6. Tooling ownership

### `tooling/toolchain.json`
Single authority for tool/compiler/CLI/SDK versions and release checksums.

### `tooling/install.mjs`
Idempotent machine-level installer. It downloads/builds only missing pinned versions into the shared tool home.

### `tooling/game-tools.example.json`
Canonical per-game **path/target** configuration. It must never contain tool versions or game-local binary paths.

### `tooling/lib/`
Shared config/path/process/toolchain resolution, including shared cache and runtime-link handling.

### `tooling/spacetime/`
Wrappers for build, bindings generation, local dev and publish. They resolve the shared pinned SpacetimeDB CLI.

### `tooling/luban/`
Luban validation/generation logic. It resolves the shared pinned Luban distribution.

Standard outputs:

```text
<outputRoot>/typescript-bin
<outputRoot>/rust-bin
<outputRoot>/bin
```

### `tooling/protobuf/`
PB validation/generation logic and Rust codegen source.

```text
Game .proto
    ├── TypeScript: shared protoc + ts-proto
    └── Rust: shared compiled prost-build generator
```

### `tooling/scripts/`
Aggregate developer/CI entry points: `generate-all.mjs` and `validate-all.mjs`.

## 7. Consuming game layout

```text
game-repo/
├── framework/                  # game-framework Git submodule
├── game-tools.json             # paths only
├── node_modules/               # ignored; Framework may create shared-runtime links
├── client/
│   └── generated/
│       ├── spacetime/
│       └── protocol/
├── server/
│   ├── spacetime/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── tables/
│   │       ├── reducers/
│   │       ├── services/
│   │       └── jobs/
│   └── native/                 # only when needed
├── shared/
│   ├── core/
│   └── protocol/
├── data/
│   ├── Datas/
│   ├── luban.conf
│   └── generated/
└── docs/
```

Dependency direction:

```text
client/server/shared -> framework
framework -X-> concrete game
```

## 8. Ownership invariant

```text
Framework owns:
  reusable runtime/framework source
  tool/CLI/compiler/SDK versions
  machine-level installation strategy
  generation/validation logic

Game owns:
  business source
  concrete tables/reducers/messages/config data
  source/output locations
```

Generated TypeScript runtime packages may be linked into a game's ignored `node_modules`, but they remain Framework-versioned shared dependencies, not game-managed installs.

## 9. Placement checklist

Before adding a file/dependency ask:

1. Does it encode one game's rules, IDs, tables, messages or semantics? Keep it in the game.
2. Is it a reusable technical mechanism/tool? Framework may own it.
3. Is it a compiler, CLI, generator, SDK baseline or installation/version rule? Framework owns it.
4. Is it a concrete SpacetimeDB table/reducer/service? Keep it in the game.
5. Is it generated output? Change source/generator instead of hand-editing.
6. Is an Adapter/Repository/Port proposed only to hide SpacetimeDB? Do not add it.
7. Is a directory only for a hypothetical future feature? Do not create it yet.
