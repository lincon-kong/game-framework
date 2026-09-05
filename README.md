# Game Framework

Reusable client/server game infrastructure and toolchain shared by multiple games.

## Architecture authority

Read in this order:

1. [`AGENTS.md`](./AGENTS.md)
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
3. [`docs/CLIENT.md`](./docs/CLIENT.md)
4. [`docs/SERVER.md`](./docs/SERVER.md)
5. [`docs/REPOSITORY_LAYOUT.md`](./docs/REPOSITORY_LAYOUT.md)
6. [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)

Framework defines **how a game runs**. Each game repository defines **what that game is**.

## Repository layout

```text
game-framework/
├── client/              reusable TypeScript/Laya runtime
├── server/
│   └── spacetime/       reusable direct SpacetimeDB Rust source + SDK baseline
├── tooling/
│   ├── toolchain.json   shared dependency/version authority
│   ├── install.mjs      one-time machine-level tool installer
│   ├── doctor.mjs       cross-platform environment/toolchain diagnosis
│   ├── spacetime/       build/dev/publish/bindings wrapper
│   ├── luban/           generation/validation wrapper
│   ├── protobuf/        PB validation/codegen source
│   └── scripts/         generate-all / validate-all
├── docs/
└── AGENTS.md
```

External tool binaries are not duplicated inside every game checkout. The Framework installer places the pinned toolchain in a shared user-level cache.

## Technology baseline

Client:

- TypeScript 5.x;
- LayaAir 3.x integration;
- owner-based lifecycle/resource management;
- source-direct local development where practical.

Backend:

- Rust stable / edition 2024;
- **direct SpacetimeDB** for ordinary game/application backend state;
- no Adapter/Repository/Port layer merely to hide SpacetimeDB;
- native Rust/Tokio/Axum only when a dedicated service or realtime battle/world server is actually needed;
- Protobuf/prost only for explicit independent protocol boundaries.

Configuration/protocol:

- Luban = static game/content configuration;
- SpacetimeDB tables = runtime/application state;
- SpacetimeDB generated bindings = normal direct client/backend contract;
- Protobuf = explicit independent protocol where needed.

Concrete game Luban tables, `.proto` messages, SpacetimeDB tables/reducers and game rules stay in each game repository.

## Dependency ownership

**Shared tooling/compiler/CLI/SDK version decisions belong to Framework, not individual games.**

Framework owns and pins:

- Luban distribution and runtime dependencies;
- SpacetimeDB CLI baseline;
- SpacetimeDB Rust/TypeScript SDK baseline;
- protoc used by PB generation;
- ts-proto and its TS runtime;
- prost-build/protoc-bin-vendored;
- generation/validation scripts.

The version authority is [`tooling/toolchain.json`](./tooling/toolchain.json).

A game owns only concrete source and path configuration:

```text
SpacetimeDB module source
.proto source
Luban schemas/tables/content
game-tools.json
```

## Install once per machine

With any Framework checkout available, run once:

```bash
node framework/tooling/install.mjs
node framework/tooling/doctor.mjs
```

Default shared location:

```text
~/.game-framework/tools/
```

All games on that machine reuse the same versioned tool cache. When Framework later pins a new tool version, it is installed side-by-side rather than replacing versions still needed by older games.

`doctor.mjs` verifies the current OS/CPU, Node/npm, .NET 8, Rust/Cargo, filesystem linking capability, relevant environment overrides, PATH copies of `spacetime`/`protoc`, and all Framework-installed tool versions. It returns non-zero when the machine is not ready.

For CI:

```bash
node framework/tooling/doctor.mjs --json
```

Generated TypeScript runtime packages are stored centrally. Generation creates lightweight project links when required; it does not run a fresh package install for each game.

## Per-game commands

Each game owns a root `game-tools.json` based on [`tooling/game-tools.example.json`](./tooling/game-tools.example.json).

Then from the game repository:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

See [`tooling/README.md`](./tooling/README.md).

## Current development model

```text
game-framework.git
bounce-ball.git
```

During active development, BounceBall may compile Framework source directly through a Git submodule. A released game pins an exact Framework commit/tag, which also pins its toolchain baseline.

The current Luban convention is derived from BounceBall's proven single-source TS/Rust/binary generation model. BounceBall currently has no concrete PB schema, so Framework defines PB generation tooling without inventing game messages.
