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
- generic network transport/RPC/session mechanisms;
- storage abstractions;
- WASM runtime/adapter mechanisms;
- Laya engine adapters;
- generic server runtime and backend adapter infrastructure;
- generic SpacetimeDB/native-server integration mechanisms;
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
Application / Platform Services
        |
Client or Server Framework
        |
Engine / OS / Network / Backend Runtime
```

Framework code should stay at the lower mechanism layers. Authentication products, ads, payment, analytics, remote config and other commercial capabilities should not be pushed into a giant framework service locator. They may use framework primitives while remaining application/platform services unless they are proven generic runtime mechanisms.

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

The default backend strategy is **SpacetimeDB-first** for ordinary game/application state, with native Rust servers added only when a concrete workload requires them.

```text
Ordinary game backend

Client
  |
  v
SpacetimeDB
  |
  v
Game application/domain/core
```

For high-frequency authoritative simulation:

```text
SpacetimeDB
 account / inventory / quest / matchmaking / settlement
            |
            v
Native Rust Battle/World Server
 tick / simulation / AOI / replication
            |
            v
SpacetimeDB
 validated result / settlement
```

Primary server technology choices:

- Rust as the shared backend/domain language;
- SpacetimeDB as the preferred first application backend for current games;
- native Rust with Tokio/Axum when a dedicated service or realtime server is needed;
- Protobuf/prost for explicit native client/server or service-to-service contracts;
- PostgreSQL/SQLx only as an optional alternative adapter when a service has a concrete reason to use a conventional relational stack;
- Redis only when a concrete cache/coordination/queue/presence use case exists;
- `tracing`/`tracing-subscriber` as the native structured logging baseline;
- Docker/Compose as the default deployment unit, compatible with 1Panel/OpenResty.

The framework must remain portable: pure game/domain/core crates should not directly depend on SpacetimeDB, Axum or SQLx unless they are explicit adapter/module layers.

Do not split into microservices by default. SpacetimeDB application logic and native services should remain as few deployable units as practical until scaling or isolation creates a real reason to split.

See `docs/SERVER.md`.

## 6. Protocol and configuration

Keep these concerns separate:

```text
Luban      = static game/content configuration
Protobuf   = explicit runtime protocol when needed
SpacetimeDB generated bindings = direct SpacetimeDB reducer/subscription contract
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

## 9. Architecture authority

For this repository, use this order:

1. nearest `AGENTS.md`;
2. `docs/ARCHITECTURE.md`;
3. `docs/CLIENT.md` / `docs/SERVER.md`;
4. `docs/REPOSITORY_LAYOUT.md`;
5. `docs/DEVELOPMENT.md`;
6. current source/build/test guards.

Old plans, closed issues, milestone notes and historical discussions are not current architecture authority unless historical analysis is explicitly requested.
