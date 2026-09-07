# Game Framework Architecture

This document is the architecture authority for `game-framework`.

## 1. Purpose

`game-framework` provides reusable technical infrastructure and a shared toolchain for multiple games. It owns mechanisms and dependency baselines, not concrete game rules.

```text
Game repositories
      |
      v
game-framework
      |
      +-- client runtime foundation
      +-- Go server foundation
      +-- shared toolchain + dependency versions
```

Dependency direction is one-way: games may depend on Framework; Framework must never depend on a concrete game.

## 2. Repository boundary

Framework may own lifecycle/loading/routing/network/WASM mechanisms, thin Pitaya integration, generic Go server primitives, generic persistence/commercial safety primitives, and shared Luban/Protobuf tooling.

Games own concrete gameplay, entities, player progression, economy values, products, quests, activities, game-specific database schemas/migrations, concrete `.proto`, Luban content, UI/assets, and production secrets. Framework owns shared PostgreSQL deployment/configuration, migration metadata and migrations belonging to its generic modules.

Rule of thumb:

> Framework defines **how a game runs and which shared baseline it runs with**. A game repository defines **what that game is**.

## 3. Client architecture

The client framework is TypeScript-first and initially targets LayaAir through adapters.

```text
AppScope
  -> PackageScope
      -> RouteScope
          -> nested RouteScope
```

Framework owns runtime mechanisms. Game code owns Controller/Model/View, business state, presentation and game rules.

Network is not a singleton assumption. A game may simultaneously keep:

```text
LobbyConnection -> Go / Pitaya
GameConnection  -> optional realtime GameServer
```

See `docs/CLIENT.md`.

## 4. Server architecture

The default server baseline is **Go + Pitaya + PostgreSQL**.

```text
Laya Client
    |
    v
Go Application
├── Pitaya online boundary
│   ├── connection/session
│   ├── route/push/group
│   └── cluster only when needed
├── business/domain services
│   ├── auth/player
│   ├── reward/economy primitives
│   ├── mail/activity
│   ├── order/payment
│   └── matchmaking/allocation
└── PostgreSQL
```

Pitaya is not the domain model. Ordinary Go services should remain testable without a running Pitaya process.

Initial deployment should use Pitaya standalone mode. Do not require etcd/NATS/Redis just because Pitaya supports them. Introduce cluster infrastructure only when multiple Go processes/nodes need service discovery/RPC/coordination.

## 5. Future heavy realtime server

Do not start with a second server language merely for future-proofing. If a real game later needs materially heavier room simulation, add a separate Rust GameServer:

```text
                 +-------------------+
Client ----------> Go / Pitaya       |
|                | login/lobby/match |
|                | commerce          |
|                +---------+---------+
|                          |
|                    join token/result
|                          |
|                +---------v---------+
+----------------> Rust GameServer   |
                 | room/tick/AI      |
                 | combat/sync       |
                 +-------------------+
```

The client connects directly to the GameServer. Go remains authoritative for commercial account settlement; Rust remains authoritative for the live match state. High-frequency frames should not bounce through Go by default.

For light realtime games, Go/Pitaya may host the room directly. Split to Rust only after requirements/profiling justify it.

## 6. Persistence and commercial state

PostgreSQL is the default durable source of truth.

Commercially sensitive mutations should converge on a small set of reusable principles:

- transaction boundaries;
- idempotency keys;
- source/audit records;
- server-side payment verification;
- explicit entitlement/reward settlement;
- no trust in client-side currency/inventory state.

Do not build a giant generic live-ops platform before real games require it. Extract reusable primitives from actual implementations.

Redis is optional cache/coordination. It is not the authoritative store for paid currency or durable player ownership.

## 7. Protocol, configuration and dependency ownership

```text
Luban       = static game/content configuration
PostgreSQL  = durable runtime/business state
Pitaya      = online runtime/session/routing mechanism
Protobuf    = explicit protocol when useful
Env/JSON    = deployment/runtime settings
Secrets     = secret/environment storage
```

Framework version authorities:

```text
server/go.mod             Go runtime dependencies (Pitaya, etc.)
tooling/toolchain.json    machine/code-generation tools
```

Concrete game protocol/config schemas remain in the game repository.

## 8. Evolution rules

- Prefer simple standalone deployment first.
- Do not introduce service discovery, message buses or distributed actors without a real multi-node requirement.
- Do not create a native Rust server before a game requires it.
- Do not wrap Pitaya behind a large fake framework abstraction; isolate only the boundary needed to keep domain code independent.
- Do not add generic Repository/Service/UseCase layers for architectural appearance.
- Add reusable commercial primitives only when semantics are truly stable across games.
- Shared dependency versions are upgraded in Framework and validated before games move their Framework pointer.
