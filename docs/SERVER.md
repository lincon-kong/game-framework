# Server Framework

This document defines the reusable server architecture and technology baseline.

## 1. Core decision

The default backend is **Go + Pitaya + PostgreSQL**.

Pitaya is used for online runtime concerns: connection/session handling, request routing, server push/groups and optional clustering. It must not become the business-domain model.

Current pinned baseline:

```text
Go       >= 1.25
Pitaya   v2.11.24
```

Pitaya `v2.11.24` is pinned by `server/go.mod`.

## 2. Design goals

The server foundation must support:

- login/account/player services;
- commercial systems such as rewards, orders, payment verification, mail, activity and leaderboards;
- cloud save and progression;
- light multiplayer directly in Go when appropriate;
- future heavy realtime GameServers without rewriting the business backend;
- simple local development and low-cost self-hosting;
- horizontal scaling by adding processes/machines when it becomes necessary.

Priority order:

1. development/maintenance efficiency;
2. commercial correctness and idempotency;
3. simple deployment/operations;
4. performance/resource efficiency;
5. clean future realtime split.

## 3. Runtime boundaries

Recommended shape:

```text
Go Process
├── Pitaya boundary
│   ├── frontend connection/session
│   ├── routes/handlers/remotes
│   ├── push/groups
│   └── cluster adapters only when enabled
│
├── Application/domain
│   ├── auth
│   ├── player
│   ├── reward/economy primitives
│   ├── mail/activity
│   ├── order/payment
│   └── matchmaking/allocation
│
└── PostgreSQL
```

Pitaya handlers should be thin. They validate/translate transport input, call ordinary Go application services and translate results back to the client.

Do not scatter `session.Session`, Pitaya contexts, route strings or transport-specific errors through domain code.

## 4. Standalone first, cluster later

Local development and small production deployments should use Pitaya standalone mode.

Do not require:

- etcd;
- NATS;
- Redis;
- Kubernetes;

until a concrete deployment actually needs them.

When multiple Go nodes are needed, Pitaya cluster mode may add service discovery/RPC. The current Pitaya baseline supports etcd service discovery and NATS/gRPC-style RPC infrastructure, but those are deployment choices rather than framework-wide mandatory dependencies.

## 5. PostgreSQL ownership

PostgreSQL is the durable source of truth for business state.

Typical game-owned data:

- platform identity/account mapping;
- player profile/progression;
- currencies/items/entitlements;
- orders/payment events/refunds;
- mail/activity state;
- save data;
- leaderboard source data;
- matchmaking/MMR where durable state is useful;
- completed match/result records.

Concrete schemas and migrations stay in the game repository until repeated usage proves a generic Framework primitive.

Prefer explicit transactions and simple SQL/pgx-style access over a large ORM abstraction unless a real project proves otherwise.

## 6. Commercial invariants

Reusable commercial code should preserve these invariants:

```text
external callback/request
        |
        v
verify provider/authenticity
        |
        v
idempotency check
        |
        v
transaction
  order/event state
  entitlement/reward
  audit/source record
        |
        v
commit
```

Never implement payment callbacks as `callback -> addCurrency()` without order/idempotency/audit boundaries.

Go is authoritative for durable commercial settlement even if a future realtime GameServer computes match rewards/results.

## 7. Client contract

The Laya client may keep a persistent Pitaya/lobby connection for session/push/application messages.

A future heavy realtime GameServer should use a second direct connection:

```text
1. Client -> Go/Pitaya login
2. Client -> Go/Pitaya matchmaking
3. Go allocates GameServer/room and issues short-lived join token
4. Client -> GameServer directly
5. GameServer validates token and runs match
6. GameServer -> Go signed/authenticated result
7. Go settles durable reward/progression transaction
```

The framework client network layer must therefore support multiple independent connections.

## 8. Light realtime in Go

For ordinary rooms/co-op/light competitive games, keep the game server in Go/Pitaya when performance is sufficient.

A reusable room runtime may later own:

```text
Room
├── Join/Leave/Reconnect
├── fixed tick when needed
├── input queue
├── authoritative state
├── snapshot/delta
└── result
```

Do not build prediction/rollback/AOI/replication machinery before a real game needs it.

## 9. Heavy realtime Rust exception

Add native Rust GameServer only for measured/credible workloads such as:

- sustained 20-30+ Hz authoritative simulation;
- hundreds of active AI/entities per room;
- heavy collision/pathfinding/skills;
- tight memory budgets where Go GC/heap overhead materially reduces density;
- latency-sensitive replication that benefits from custom data layout/allocation control.

Rust GameServer owns live match state only. It should not duplicate payment/mail/activity/account systems.

Keep Go out of the hot Tick path. Prefer direct client <-> Rust traffic and low-frequency Go <-> Rust control/result messages.

## 10. Protocol

Protobuf is the preferred explicit binary protocol where a schema is valuable, including:

- Laya <-> Go realtime/application messages when Pitaya route payloads use PB;
- Laya <-> future Rust GameServer;
- Go <-> Rust control/result protocols.

One game-owned `.proto` source tree should generate TypeScript and Go today. Add Rust output only when a real Rust consumer exists.

## 11. Testing

High-value server tests:

- auth/provider verification;
- payment callback signature and idempotency;
- transaction rollback/atomicity;
- reward/order invariants;
- reconnect/session lifecycle where used;
- protocol compatibility;
- room/tick/realtime correctness only for games that implement it.

Framework tests cover reusable mechanisms; concrete game business behavior stays in game tests.

## 12. Deployment

Initial topology:

```text
Internet
   |
OpenResty / Nginx (optional)
   |
Go / Pitaya standalone
   |
PostgreSQL
```

Scale only when needed:

```text
LB
├── Go/Pitaya #1
├── Go/Pitaya #2
└── Go/Pitaya #N

PostgreSQL
+ optional Redis/etcd/NATS according to the chosen clustered topology
```

A Rust GameServer pool is a separate optional scale unit for heavy realtime games.
