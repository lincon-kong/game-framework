# Server Framework

This document defines the reusable server-side architecture and technology baseline.

## 1. Core decision

The default backend is **SpacetimeDB directly**.

Do not add an Adapter/Repository/Port layer merely to hide SpacetimeDB.

For ordinary game backend work, game code may directly use:

- SpacetimeDB tables;
- reducers;
- reducer context;
- subscriptions;
- transactions;
- scheduled reducers;
- generated client bindings.

The goal is to keep the normal backend path short, explicit and easy to develop.

```text
Client
  |
  v
SpacetimeDB generated bindings / subscriptions / reducers
  |
  v
Game SpacetimeDB Module
  ├── tables
  ├── reducers
  ├── services/domain logic
  └── scheduled jobs
```

Do not wrap this path in a generic database abstraction unless a concrete future requirement proves that abstraction is needed.

## 2. Design goals

The server foundation must support:

- small single-player/IAA games with online services;
- account, inventory, progression, activity, mail, season and leaderboard systems;
- multiplayer roguelikes and room-based games;
- authoritative native Rust battle servers when required;
- future extraction/MMO-style games without forcing unnecessary infrastructure today.

Priorities:

1. development efficiency;
2. correctness and testability;
3. simple deployment and operations;
4. explicit ownership of game state;
5. Rust code reuse where it is genuinely useful;
6. ability to split high-frequency realtime simulation later.

## 3. Language

Rust is the primary server language.

Use Rust stable and edition 2024 for new crates/modules where supported by the selected SpacetimeDB/native toolchain.

Rust is used for:

- SpacetimeDB modules;
- reusable pure game/domain/core code;
- native realtime battle/world servers;
- server-side tooling where appropriate.

## 4. SpacetimeDB application backend

SpacetimeDB directly owns ordinary persistent/application game state.

Typical tables include game-owned concepts such as:

- player/account mapping;
- inventory/equipment;
- progression/economy;
- quests/activities/mail/season;
- matchmaking/MMR metadata;
- room/application state;
- settlement/result state.

These concrete tables and reducers belong to the **game repository**, not `game-framework`.

A game module may be organized conceptually as:

```text
server/spacetime/
├── src/
│   ├── lib.rs
│   ├── tables/
│   ├── reducers/
│   ├── services/
│   ├── jobs/
│   └── error.rs
└── Cargo.toml
```

### Direct-use rule

Reducers and services may use SpacetimeDB APIs directly.

Do not introduce abstractions such as:

```text
PlayerRepository
InventoryRepository
DatabaseAdapter
SpacetimeAdapter
PersistencePort
```

just to make the code appear database-independent.

If repeated logic is pure game logic, extract that logic into a normal Rust module/crate. Do not hide the database itself.

### Pure GameCore exception

Deterministic simulation/rules that need to run in multiple environments may remain platform-independent:

```text
pure Rust GameCore
     ↑        ↑
     |        |
SpacetimeDB   Client WASM / Native Battle Server
```

This separation exists for actual code reuse and deterministic execution, not to create a generic persistence adapter layer.

## 5. Client/server interaction

For direct SpacetimeDB application-backend interaction, prefer the SpacetimeDB generated client bindings and native reducer/subscription model.

```text
Laya Client
   |
   v
Generated SpacetimeDB bindings
   |
   ├── reducers
   └── subscriptions
   |
   v
SpacetimeDB Module
```

Do not duplicate every reducer/subscription call into Protobuf RPC.

Use Protobuf only when there is an actual independent protocol boundary, for example:

- client <-> native battle server;
- native service <-> native service;
- replay/input protocol that must be transport-independent;
- external integration that benefits from an explicit PB contract.

## 6. Configuration model

Keep responsibilities clear:

```text
SpacetimeDB = runtime/player/application state
Luban       = static game/content configuration
Protobuf    = explicit native protocol when required
Env/TOML    = deployment/runtime settings
Secrets     = secret/environment storage
```

Concrete Luban tables remain in the game repository.

## 7. Native Rust realtime server

Do not introduce a native server merely because one might be needed later.

Use it when SpacetimeDB is no longer the right execution environment for a concrete hot simulation workload, such as:

- high-frequency authoritative tick simulation;
- heavy AOI/state replication;
- latency-sensitive competitive combat;
- specialized UDP/QUIC transport;
- rollback/lag compensation;
- large world/battle simulation with independent scaling requirements.

Recommended hybrid topology:

```text
             SpacetimeDB
 account / inventory / quest / matchmaking
                  |
                  | create match / state
                  v
       Native Rust Battle/World Server
       tick / simulation / AOI / replication
                  |
                  | validated result
                  v
             SpacetimeDB
            settlement/state
```

Native baseline when it is actually needed:

- Rust;
- Tokio;
- Axum for HTTP/WebSocket/admin/health endpoints where appropriate;
- Protobuf + prost for explicit protocols;
- tracing/tracing-subscriber;
- Docker/Compose.

Game simulation remains in the game repository.

## 8. Framework server scope

`game-framework` may provide reusable SpacetimeDB-oriented utilities only when real repetition appears, for example:

- common validation/error helpers;
- generic identity/session primitives;
- reusable time/version helpers;
- observability conventions;
- test support;
- build/code-generation tooling;
- shared native realtime-server primitives.

These helpers may directly target SpacetimeDB. They do not need an abstraction layer pretending another backend is interchangeable.

Framework must not contain:

- Bounce Ball tables/reducers;
- game-specific inventory/economy semantics;
- concrete quests/activities/mail logic;
- game-specific protocol definitions;
- game-specific Luban tables;
- game-specific battle rules;
- production secrets.

## 9. Suggested framework layout

```text
server/
├── spacetime/
│   ├── common/
│   ├── session/
│   ├── observability/
│   └── test-support/
│
├── native/
│   └── crates/
│       ├── runtime/
│       ├── transport/
│       ├── session/
│       ├── protocol/
│       ├── observability/
│       └── test-support/
│
└── README.md
```

Create these directories only when real code requires them.

There is intentionally no generic `persistence/adapter/repository` layer in the baseline architecture.

## 10. Game repository layout

A game backend should look closer to this:

```text
game-repo/
├── server/
│   ├── spacetime/
│   │   ├── tables/
│   │   ├── reducers/
│   │   ├── services/
│   │   └── jobs/
│   │
│   └── native/          # only when required
│
├── shared/
│   ├── core/            # reusable pure Rust GameCore/domain code
│   ├── protocol/        # PB only for independent protocol boundaries
│   └── luban/           # static game configuration
│
└── client/
```

## 11. Error handling

- game/domain errors remain typed where useful;
- reducer entry points convert errors to stable client-visible results;
- internal persistence/runtime details are not exposed to clients;
- use `thiserror` for typed reusable errors where useful;
- use `anyhow` mainly at tooling/bootstrap boundaries where typed recovery is unnecessary.

Do not add an error-adapter hierarchy solely to preserve architectural layering.

## 12. Testing

SpacetimeDB backend tests should focus on real behavior:

- reducer authorization/preconditions;
- table state transitions;
- economy/settlement atomicity;
- scheduled reducer behavior;
- idempotency where required;
- deterministic GameCore behavior;
- client binding/protocol compatibility at important boundaries.

Framework tests should cover only reusable framework invariants.

## 13. Deployment

Current preferred deployment:

```text
Internet
   |
OpenResty / Nginx (when needed)
   |
SpacetimeDB
   |
   +-- Native Rust Battle/World Server (only when needed)
```

Use self-hosted SpacetimeDB with Docker/systemd/1Panel-compatible deployment according to the concrete environment.

Do not require Kubernetes or a traditional PostgreSQL/Redis backend stack for the initial architecture.
