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
│   ├── go.mod           Go server dependency baseline
│   └── pitaya/          thin Pitaya integration helpers
├── tooling/
│   ├── toolchain.json   shared machine-tool/version authority
│   ├── install.mjs      one-time machine-level tool installer
│   ├── doctor.mjs       cross-platform environment/toolchain diagnosis
│   ├── go/              Go validation wrapper
│   ├── luban/           generation/validation wrapper
│   ├── protobuf/        TS/Go PB validation/codegen
│   └── scripts/         generate-all / validate-all
├── docs/
└── AGENTS.md
```

## Technology baseline

Client:

- TypeScript 5.x;
- LayaAir 3.x integration;
- owner-based lifecycle/resource management;
- multiple independent network connections are allowed; do not assume one global socket.

Backend:

- Go 1.25+;
- Pitaya v2.11.24 as the default online/session/game-server framework baseline;
- PostgreSQL as the default durable business-state store;
- standalone Pitaya first; etcd/NATS/Redis are optional and introduced only when their scaling/use case exists;
- business/domain code stays ordinary Go and should not depend on Pitaya types unless it is at the transport/runtime boundary;
- a separate native Rust GameServer is an optional future path for genuinely CPU-heavy realtime simulation.

Configuration/protocol:

- Luban = static game/content configuration;
- PostgreSQL = durable account/player/commercial state;
- Protobuf = explicit client/server or service protocol where useful;
- Pitaya route/session/group APIs = online runtime mechanisms, not the business-domain model.

Concrete game tables, messages, game rules, payment products and activities stay in each game repository.

## Server topology

Current/default topology:

```text
Laya Client
    |
    v
Go / Pitaya
├── login/session
├── lobby/push
├── commercial APIs
├── matchmaking/room allocation when needed
└── PostgreSQL
```

Future heavy realtime topology, only when required:

```text
                 +--> Go / Pitaya
Laya Client -----|    login/lobby/commercial/match
                 |
                 +--> Rust GameServer
                      room/tick/AI/combat/sync
```

The client connects directly to the Rust GameServer with a short-lived join token. High-frequency battle traffic must not be proxied through Go merely for architectural symmetry.

## Dependency ownership

- [`server/go.mod`](./server/go.mod) is the authority for Framework Go runtime dependencies such as Pitaya.
- [`tooling/toolchain.json`](./tooling/toolchain.json) is the authority for machine-installed/code-generation tools.
- Games pin an exact Framework commit/tag and do not independently choose incompatible Framework dependency versions.

Current server baseline pins Pitaya `v2.11.24`. The release requires Go `1.25+`.

## Install once per machine

```bash
node framework/tooling/install.mjs
node framework/tooling/doctor.mjs
```

Default shared location:

```text
~/.game-framework/tools/
```

The installer keeps Luban and PB code-generation tools in a shared versioned cache. Go itself remains a normal machine toolchain and Go modules remain managed by `go.mod`.

For CI:

```bash
node framework/tooling/doctor.mjs --json
```

## Per-game commands

Each game owns a root `game-tools.json` based on [`tooling/game-tools.example.json`](./tooling/game-tools.example.json).

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

The default generated configuration readers are TypeScript + Go. Rust generation is optional and enabled only by games that actually own Rust code.

See [`tooling/README.md`](./tooling/README.md).
