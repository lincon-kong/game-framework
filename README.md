# Game Framework

Reusable client/server game infrastructure shared by multiple games.

## Architecture authority

Read in this order:

1. [`AGENTS.md`](./AGENTS.md) — repository rules and contributor constraints;
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — overall architecture and boundaries;
3. [`docs/CLIENT.md`](./docs/CLIENT.md) — client architecture;
4. [`docs/SERVER.md`](./docs/SERVER.md) — server architecture and technology choices;
5. [`docs/REPOSITORY_LAYOUT.md`](./docs/REPOSITORY_LAYOUT.md) — directory ownership and placement rules;
6. [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — local development, dependency and versioning workflow.

These documents are long-lived architecture authority. Temporary plans/task notes must not override them.

## Core boundary

```text
Game repositories
      |
      v
game-framework
```

`game-framework` owns generic runtime mechanisms and tooling only. It must never depend on Bounce Ball or another concrete game.

Framework defines **how a game runs**. Each game repository defines **what that game is**.

## Target layout

```text
game-framework/
├── client/          reusable TypeScript/Laya client runtime
├── server/          reusable native Rust server foundation
├── tooling/         generic Protobuf/Luban/build helpers
├── docs/            architecture authority
└── AGENTS.md
```

Directories are added when real code exists; do not build empty framework skeletons prematurely.

## Technology baseline

Client:

- TypeScript 5.x;
- LayaAir 3.x adapter integration;
- owner-based lifecycle/resource management;
- source-direct local development where practical.

Server:

- Rust stable / edition 2024;
- Tokio;
- Axum;
- Protobuf + prost;
- PostgreSQL + SQLx;
- Redis optional;
- tracing-based observability;
- Docker/Compose deployment compatible with 1Panel/OpenResty.

Static game/content configuration uses Luban in each game repository. Runtime client/server contracts use Protobuf in each game repository. The framework may own shared generation/runtime tooling but not concrete game data/messages.

## Current development model

Current repositories:

```text
game-framework.git
bounce-ball.git
```

During active development, Bounce Ball may compile framework source directly through a Git submodule. A released game pins an exact framework commit/tag for reproducibility.

The first implementation source is the existing Bounce Ball client framework; migration must preserve validated behavior while removing Bounce Ball-specific naming and assumptions.
