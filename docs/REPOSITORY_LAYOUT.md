# Repository Layout

This document defines the target directory layout and ownership rules for `game-framework`.

## 1. Current/target layout

```text
game-framework/
├── AGENTS.md
├── README.md
│
├── client/
│   ├── src/
│   ├── tests/
│   └── README.md
│
├── server/
│   ├── spacetime/
│   │   ├── Cargo.toml
│   │   ├── src/lib.rs
│   │   └── README.md
│   ├── native/                  # create only when a real game needs it
│   └── README.md
│
├── tooling/
│   ├── toolchain.json           # shared dependency/version authority
│   ├── bootstrap.mjs            # prepares Framework-owned external tools
│   ├── package.json
│   ├── game-tools.example.json
│   ├── lib/
│   │   ├── game-config.mjs
│   │   └── toolchain.mjs
│   ├── spacetime/
│   │   ├── bin/<platform>-<arch>/
│   │   ├── run.mjs
│   │   └── README.md
│   ├── luban/
│   │   ├── Luban/               # complete pinned Luban distribution
│   │   ├── LICENSE
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
│
└── docs/
    ├── ARCHITECTURE.md
    ├── CLIENT.md
    ├── SERVER.md
    ├── REPOSITORY_LAYOUT.md
    └── DEVELOPMENT.md
```

Do not create empty future skeletons. Tool binary directories appear when `tooling/bootstrap.mjs` installs or when a pinned distribution is intentionally vendored into Framework Git.

## 2. Root ownership

### `README.md`
Repository entry point and documentation index.

### `AGENTS.md`
Mandatory rules for humans/Codex/automated contributors, including dependency ownership.

### `docs/`
Long-lived architecture authority. Do not store temporary task plans/status logs here.

## 3. Client ownership

`client/` contains reusable TypeScript/Laya runtime mechanisms only: lifecycle, asset/package/router/UI/event/timer/update/pool/entity/FSM/module/network/storage/log/crash/performance/WASM/error/Laya integration and focused tests.

Concrete game routes, UI, controllers, models, assets, APIs and gameplay remain game-owned.

## 4. Server ownership

### `server/spacetime/`
A real reusable Rust crate for the default **direct SpacetimeDB** backend model.

It owns the Framework-supported Rust SpacetimeDB SDK baseline and may expose/re-export small reusable helpers/types. It is not an Adapter/Repository/Port abstraction.

Concrete player/inventory/quest/economy/stage/battle tables and reducers stay in the game repository.

### `server/native/`
Reserved for reusable native Rust server foundations only when a real consumer requires dedicated process/realtime behavior. Do not create Tokio/Axum/world-server skeletons in advance.

There is intentionally no baseline `persistence/adapter/repository` layer.

## 5. Toolchain ownership

### `tooling/toolchain.json`
Single authority for shared tool/compiler/CLI/SDK baseline versions.

Current categories include:

- Luban distribution version;
- SpacetimeDB CLI/Rust/TypeScript SDK baseline;
- ts-proto;
- grpc-tools/protoc;
- prost-build;
- protoc-bin-vendored.

A concrete game must not override these versions.

### `tooling/bootstrap.mjs`
Prepares Framework-owned external dependencies under the Framework tree. It does not install a separate copy per game.

### `tooling/game-tools.example.json`
Canonical **per-game path configuration** example. Consuming games copy/adapt it as root `game-tools.json`.

It may configure source/output/database paths, but never tool versions or game-local tool binary paths.

### `tooling/lib/`
Shared implementation for config/path/process/toolchain resolution.

### `tooling/spacetime/`
Owns the pinned SpacetimeDB CLI distribution and wrappers for build, binding generation, local dev and publish.

Games own their module source and binding output paths only.

### `tooling/luban/`
Owns the **complete pinned Luban release distribution and dependencies**, license and generation/validation mechanics.

Games own only `luban.conf`, schemas/spreadsheets/content and generated outputs.

Standard output follows the BounceBall-proven model:

```text
<outputRoot>/typescript-bin
<outputRoot>/rust-bin
<outputRoot>/bin
```

### `tooling/protobuf/`
Owns all PB generation/compiler dependencies.

```text
Game .proto
    ├── TypeScript: Framework grpc-tools/protoc + ts-proto
    └── Rust: Framework prost-build + protoc-bin-vendored
```

No separate client/server proto source and no game-local protoc/codegen packages.

### `tooling/scripts/`
Aggregate developer/CI entry points:

```text
generate-all.mjs
validate-all.mjs
```

## 6. Consuming game layout

A game should converge on:

```text
game-repo/
├── framework/                  # game-framework Git submodule
├── game-tools.json             # paths only, no tool versions
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

The exact paths are configurable through `game-tools.json`; ownership is the invariant.

Dependency direction:

```text
client/server/shared -> framework
framework -X-> concrete game
```

## 7. Dependency ownership rule

```text
Framework owns:
  runtime/framework source
  tool binaries/distributions
  compiler/codegen dependencies
  shared SDK version baseline
  generation/validation logic

Game owns:
  business source
  concrete schemas/tables/messages
  game configuration content
  source/output locations
```

Some SDK packages may physically appear in a consuming game's npm/Cargo graph because its compiler/generated code needs them. This is permitted only as a build-resolution detail: the supported version is still chosen by Framework.

## 8. Placement checklist

Before adding a file/dependency ask:

1. Does it encode one game's rules, IDs, tables, messages or feature semantics? Keep it in the game.
2. Is it a reusable technical mechanism/tool? Framework may own it.
3. Is it a compiler, CLI, generator, SDK baseline or its version rule? Framework owns it.
4. Is it concrete SpacetimeDB table/reducer/service logic? Keep it in the game.
5. Is it generated output? Change source/generator instead of hand-editing.
6. Is an Adapter/Repository/Port proposed only to hide SpacetimeDB? Do not add it.
7. Is a directory being created only for a hypothetical future feature? Do not create it yet.
