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
│   │   ├── Framework.ts
│   │   ├── FrameworkAccess.ts
│   │   ├── lifecycle/
│   │   ├── asset/
│   │   ├── package/
│   │   ├── router/
│   │   ├── ui/
│   │   ├── event/
│   │   ├── timer/
│   │   ├── update/
│   │   ├── pool/
│   │   ├── entity/
│   │   ├── fsm/
│   │   ├── module/
│   │   ├── network/
│   │   ├── storage/
│   │   ├── log/
│   │   ├── crash/
│   │   ├── perfdog/
│   │   ├── wasm/
│   │   ├── error/
│   │   └── laya/
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── server/
│   ├── spacetime/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   └── lib.rs
│   │   └── README.md
│   ├── native/                  # create only when a real game needs it
│   └── README.md
│
├── tooling/
│   ├── package.json
│   ├── game-tools.example.json
│   ├── lib/
│   │   └── game-config.mjs
│   ├── spacetime/
│   │   └── run.mjs
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
│
└── docs/
    ├── ARCHITECTURE.md
    ├── CLIENT.md
    ├── SERVER.md
    ├── REPOSITORY_LAYOUT.md
    └── DEVELOPMENT.md
```

Do not create empty directory skeletons merely because a diagram lists a future capability.

## 2. Root files

### `README.md`
Repository entry point and documentation index.

### `AGENTS.md`
Mandatory repository rules for humans/Codex/other automated contributors. It defines architecture authority, forbidden dependency directions and placement rules.

### `docs/`
Long-lived architecture authority. Do not store temporary task plans/status logs here.

## 3. Client ownership

### `client/src/lifecycle/`
Owner/scope topology, registration/disposal and lifecycle state.

### `client/src/asset/`
Generic asset load/release/cache mechanisms. No game asset IDs.

### `client/src/package/`
Generic package load/unload lifecycle. No concrete game package names.

### `client/src/router/`
Route model/history/lifecycle integration. No concrete game routes.

### `client/src/ui/`
Generic layer/mount/popup/view-host mechanisms. No game UI.

### `client/src/event/`, `timer/`, `update/`
Owner-aware events/timers and frame/fixed-step scheduling.

### `client/src/pool/`, `entity/`, `fsm/`, `module/`
Generic runtime primitives only; game ECS/components/state machines remain game-owned when domain-specific.

### `client/src/network/`
Generic transport primitives used outside direct SpacetimeDB bindings. No game API methods/messages.

### `client/src/storage/`
Local storage/migration primitives. No authoritative player-save schema.

### `client/src/log/`, `crash/`, `perfdog/`
Logging, crash/error reporting and optional performance instrumentation.

### `client/src/wasm/`
Generic WASM loading/memory/call mechanisms. No game ABI semantics.

### `client/src/error/`
Framework error primitives/failure categories.

### `client/src/laya/`
LayaAir-specific integration. Engine coupling should stay here where practical.

### `client/tests/`
Focused contract/invariant tests.

## 4. Server ownership

### `server/spacetime/`
A real reusable Rust crate for the default **direct SpacetimeDB** backend model.

It may directly depend on SpacetimeDB and expose small reusable helpers such as common caller/ownership/validation conventions. It is not an Adapter/Repository/Port abstraction.

A consuming game may path-depend on this crate while its own module directly uses SpacetimeDB APIs.

Do not put concrete player/inventory/quest/economy/stage/battle tables or reducers here.

### `server/native/`
Reserved for reusable native Rust server foundations only when a real consumer requires dedicated process/realtime behavior. Do not create Tokio/Axum/world-server skeletons in advance.

There is intentionally no baseline `persistence/adapter/repository` layer.

## 5. Tooling ownership

### `tooling/game-tools.example.json`
Canonical per-game toolchain configuration example. Consuming games copy/adapt it as root `game-tools.json`.

### `tooling/lib/`
Small shared implementation used by framework codegen commands: config loading, game/framework path resolution and process execution.

### `tooling/spacetime/`
Wraps official SpacetimeDB CLI for build, bindings generation, local dev and publish. Generated bindings are the direct typed client contract.

### `tooling/luban/`
Validates and invokes Luban. Current standard output follows BounceBall's proven model:

```text
<outputRoot>/typescript-bin
<outputRoot>/rust-bin
<outputRoot>/bin
```

Framework owns generation mechanics; games own `luban.conf`, schemas/spreadsheets and content.

### `tooling/protobuf/`
Validates one game-owned `.proto` source and exports:

```text
.proto -> TypeScript (ts-proto)
       -> Rust (prost-build)
```

No separate client/server proto sources.

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
├── game-tools.json
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
│   ├── core/                   # portable game Rust/GameCore when useful
│   └── protocol/               # concrete `.proto` only when PB is needed
├── data/
│   ├── Datas/                  # Luban source (BounceBall-compatible convention)
│   ├── luban.conf
│   └── generated/
├── tools/
└── docs/
```

The exact game paths are configurable through `game-tools.json`; the important rule is ownership, not one hard-coded path.

Dependency direction:

```text
client/server/shared -> framework
framework -X-> concrete game
```

Normal game backend code directly uses SpacetimeDB. Do not insert a database abstraction layer by default.

## 7. Source-of-truth rules

- SpacetimeDB game module source: game repository.
- SpacetimeDB reusable helpers/tooling: framework.
- Luban schema/data: game repository.
- Luban generator/export convention: framework.
- `.proto`: game repository.
- PB generator/export convention: framework.
- generated output: derived; never hand-edit.

## 8. Placement checklist

Before adding a file ask:

1. Does it encode one game's rules, IDs, tables, messages or feature semantics? Keep it in the game.
2. Is it a reusable technical mechanism/tool that works without importing a game? Framework may own it.
3. Is it concrete SpacetimeDB table/reducer/service logic? Keep it in the game; only proven common helpers move to `server/spacetime`.
4. Is it generated output? Change the source/generator instead of editing the generated file.
5. Is an Adapter/Repository/Port being proposed only to hide SpacetimeDB? Do not add it.
6. Is a directory being created only for a hypothetical future feature? Do not create it yet.
