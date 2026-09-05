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
- generic server runtime, transport and persistence infrastructure;
- generic Protobuf/Luban/code-generation tooling.

Must remain in each game repository:

- game rules and authoritative game state;
- concrete entities, skills, buffs, monsters, stages and combat logic;
- player progression, economy, quests, activities and game-specific services;
- concrete game Protobuf messages;
- concrete game Luban tables and generated game data;
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
Engine / OS / Network / Database
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

The default server foundation is native Rust and follows a modular-monolith-first strategy.

```text
Transport
   |
Session / Request Context
   |
Application Modules
   |
Domain / Game Services
   |
Persistence / External Services
```

Baseline technology choices:

- Rust stable, edition 2024 for new crates;
- Tokio for async runtime;
- Axum for HTTP/WebSocket service endpoints;
- Protobuf for game runtime protocol contracts;
- `prost` on Rust side for Protobuf code generation/runtime;
- PostgreSQL as default authoritative relational persistence;
- SQLx as default PostgreSQL access/migration layer;
- Redis only when a concrete use case requires cache, ephemeral coordination, rate state, queues or ranking acceleration;
- `tracing`/`tracing-subscriber` as the logging and structured tracing baseline;
- `serde` for non-Protobuf configuration/administrative serialization;
- Docker/Compose as the default deployable unit; compatible with 1Panel and OpenResty reverse proxy.

Do not split into microservices by default. Start with one deployable server containing well-separated modules. Extract services only when scaling, isolation or operational ownership creates a real reason.

Realtime battle simulation is not required to live in the ordinary HTTP application process. Games that need higher-frequency authoritative simulation may use a dedicated native Rust battle/world server while reusing framework transport/session/observability primitives.

SpacetimeDB may be chosen by a concrete game where it provides clear value, but it is not a mandatory framework dependency. The framework must preserve portability to PostgreSQL/native Rust architectures.

See `docs/SERVER.md`.

## 6. Protocol and configuration policy

Two concepts must stay separate:

```text
Luban      = static game/content configuration
Protobuf   = runtime client/server communication contracts
```

The framework may provide generators, codecs, envelope/session primitives and validation tooling. Concrete game schemas stay with the game.

A game should keep one source of truth:

```text
Game Luban source -> generated client/server/core data
Game .proto source -> generated TypeScript/Rust protocol code
```

Do not maintain separate client and server copies of the same table or message definition.

## 7. Framework evolution

Prefer additive and backward-compatible changes.

- bug fix: patch-level behavior change with no intentional API break;
- compatible new capability: minor-level change;
- silent semantic changes are forbidden;
- deprecate before removing when practical;
- breaking changes require explicit migration and a major-version boundary once formal releases are used.

During active development, a game may compile framework source directly. A released game must pin an exact framework commit/tag so the build is reproducible.

## 8. Testing policy

Keep tests around architectural invariants and failure boundaries, not implementation trivia.

Examples:

- lifecycle parent/child disposal;
- duplicate/idempotent disposal;
- package load de-duplication and rollback;
- router history and nested disposal;
- update catch-up limits and owner cancellation;
- server request/session cancellation;
- transaction/error boundaries;
- protocol compatibility and code-generation checks.

## 9. Source of truth

For framework behavior use, in order:

1. current working tree and nearest `AGENTS.md`;
2. `docs/ARCHITECTURE.md`;
3. `docs/CLIENT.md` / `docs/SERVER.md` / `docs/REPOSITORY_LAYOUT.md`;
4. current tests, validation scripts and source.

Old plans, completed task notes and historical PR discussions are not current architecture authority unless historical analysis is explicitly requested.
