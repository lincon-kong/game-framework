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
│   └── spacetime/       reusable direct SpacetimeDB Rust source
├── tooling/
│   ├── spacetime/       build/dev/publish/bindings
│   ├── luban/           validate/generate TS+Rust+binary
│   ├── protobuf/        validate/generate TS+Rust
│   └── scripts/         generate-all / validate-all
├── docs/
└── AGENTS.md
```

Native Rust server foundations are added only when a real high-frequency/dedicated-server workload requires them.

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

Framework owns generation/validation/export tooling. Concrete game Luban tables, `.proto` messages, SpacetimeDB tables/reducers and game rules stay in each game repository.

## Shared toolchain

Each game owns a root `game-tools.json` based on [`tooling/game-tools.example.json`](./tooling/game-tools.example.json).

From a game repository with Framework mounted at `framework/`:

```bash
cd framework/tooling && npm install
cd ../..
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

See [`tooling/README.md`](./tooling/README.md).

## Current development model

```text
game-framework.git
bounce-ball.git
```

During active development, BounceBall may compile Framework source directly through a Git submodule. A released game pins an exact Framework commit/tag for reproducibility.

The current Luban tool convention is derived from BounceBall's proven single-source TS/Rust/binary generation model. BounceBall currently has no concrete PB schema, so the Framework defines PB generation tooling without inventing game messages.
