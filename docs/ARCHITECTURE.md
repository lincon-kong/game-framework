# Game Framework Architecture

This document is the architecture authority for `game-framework`.

## 1. Purpose

`game-framework` provides reusable technical infrastructure for multiple games. It owns mechanisms, not game rules.

```text
Game repositories
      |
      v
game-framework
      |
      +-- client runtime foundation
      +-- server runtime foundation
      +-- shared tooling
```

Dependency direction is one-way: games may depend on the framework; the framework must never depend on a concrete game.

## 2. Repository boundary

Allowed in the framework:

- lifecycle and ownership primitives;
- package/resource loading;
- routing and UI runtime primitives;
- events, timers, update scheduling and pools;
- logging, crash reporting and observability;
- generic network/session mechanisms;
- storage primitives used by the client;
- WASM runtime mechanisms;
- Laya engine adapters;
- reusable SpacetimeDB-oriented server helpers;
- reusable native realtime-server primitives;
- generic Protobuf/Luban/code-generation tooling.

Must remain in each game repository:

- game rules and authoritative game state;
- concrete entities, skills, buffs, monsters, stages and combat logic;
- player progression, economy, quests, activities and game-specific services;
- concrete game Protobuf messages;
- concrete game Luban tables and generated game data;
- concrete SpacetimeDB tables/reducers owned by that game;
- game UI, assets and presentation;
- secrets and environment-specific production configuration.

Rule of thumb:

> Framework defines **how a game runs**. A game repository defines **what that game is**.

## 3. Logical layers

```text
Game Feature / Domain
        |
Client Framework or SpacetimeDB/Native Runtime
        |
Engine / OS / Network / Database Runtime
```

Do not insert abstraction layers merely to make technologies appear interchangeable. Use a layer only when it solves a real ownership, reuse, testing or runtime problem.

## 4. Client architecture

The client framework is TypeScript-first and initially targets LayaAir through adapters.

Core ownership model:

```text
AppScope
  -> PackageScope
      -> RouteScope
          -> nested RouteScope
```

Framework-owned resources are registered against an owner and released automatically when the owner is disposed. Parent disposal cascades to children. Async work must not commit resources or presentation state after ownership becomes inactive.

Primary client capabilities:

```text
Lifecycle
Asset
Package
Router
UI
Event
Timer
Update
Pool
Entity runtime
FSM
Module extension
Network transport
Storage
Log / Crash
Perf hooks
WASM runtime
Laya adapters
```

The framework owns runtime mechanisms and route/lifecycle topology. Game code owns Controller/Model/View, business state, presentation and game rules.

See `docs/CLIENT.md`.

## 5. Server architecture

The default backend is **direct SpacetimeDB**.

```text
Client
  |
  v
SpacetimeDB generated bindings
  |
  v
Game SpacetimeDB Module
  ├── tables
  ├── reducers
  ├── services/domain logic
  └── scheduled jobs
```

Do not add a generic Adapter/Repository/Port layer between game backend code and SpacetimeDB merely to preserve database independence.

Concrete game tables/reducers live in the game repository and may use SpacetimeDB APIs directly.

Pure deterministic Rust GameCore/domain code may remain platform-independent when it must be reused by client WASM, SpacetimeDB and/or native realtime servers.

For high-frequency authoritative simulation, add a native Rust server only when a real requirement appears:

```text
SpacetimeDB
 account / inventory / quest / matchmaking
            |
            v
Native Rust Battle/World Server
 tick / simulation / AOI / replication
            |
            v
SpacetimeDB
 validated result / settlement
```

Native baseline when needed:

- Rust;
- Tokio;
- Axum where HTTP/WebSocket/admin/health endpoints are useful;
- Protobuf/prost for explicit independent protocols;
- tracing/tracing-subscriber;
- Docker/Compose.

Do not introduce PostgreSQL/SQLx/Redis into the baseline architecture unless a concrete future service independently requires them.

See `docs/SERVER.md`.

## 6. Protocol and configuration

Keep these concerns separate:

```text
Luban      = static game/content configuration
SpacetimeDB generated bindings = ordinary client/backend reducer/subscription contract
Protobuf   = explicit independent protocol when needed
Runtime config = TOML/JSON/environment variables
Secrets    = environment/secret storage
```

Concrete game PB schemas and Luban tables live in the game repository, not in `game-framework`.

Do not duplicate a SpacetimeDB reducer/subscription interface into Protobuf merely to make every transport look identical.

## 7. Framework-to-game relationship

Current repository model:

```text
game-framework.git
bounce-ball.git
```

During active development, a game may compile framework source directly, including through a Git submodule. A released game pins an exact framework commit/tag so historical builds remain reproducible.

The game repository owns:

```text
client/
server/
shared/
  core/
  protocol/
  luban/
```

The framework repository owns only reusable technical mechanisms.

## 8. Evolution rules

- Prefer additive, backward-compatible framework changes.
- Existing behavior must not change silently.
- Do not promote game code merely because it might be reused later.
- Extract a capability when it is demonstrably generic or intrinsic to the runtime layer.
- Keep bug fixes independently reviewable/backportable where practical.
- Avoid frequent major versions.
- Do not create empty architecture layers before a real consumer requires them.
- Do not add Adapter/Repository layers without a concrete need.

## 9. Architecture authority

For this repository, use this order:

1. nearest `AGENTS.md`;
2. `docs/ARCHITECTURE.md`;
3. `docs/CLIENT.md` / `docs/SERVER.md`;
4. `docs/REPOSITORY_LAYOUT.md`;
5. `docs/DEVELOPMENT.md`;
6. current source/build/test guards.

Old plans, closed issues, milestone notes and historical discussions are not current architecture authority unless historical analysis is explicitly requested.
