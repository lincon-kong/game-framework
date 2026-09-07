# Repository Layout

This document defines the target directory layout and ownership rules for `game-framework`.

## 1. Framework repository

```text
game-framework/
├── AGENTS.md
├── README.md
├── client/
│   └── README.md
├── server/
│   ├── go.mod
│   ├── deploy/       # shared PostgreSQL Compose and env template
│   ├── storage/      # PostgreSQL pool, SQL migration runner and tests
│   ├── pitaya/
│   │   ├── app.go
│   │   └── README.md
│   └── README.md
├── tooling/
│   ├── toolchain.json
│   ├── install.mjs
│   ├── doctor.mjs
│   ├── game-tools.example.json
│   ├── lib/
│   ├── go/
│   ├── luban/
│   ├── protobuf/
│   ├── scripts/
│   └── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── CLIENT.md
    ├── SERVER.md
    ├── REPOSITORY_LAYOUT.md
    └── DEVELOPMENT.md
```

Do not create empty framework packages for hypothetical systems. Add packages as real consumers appear.

## 2. Client ownership

`client/` contains reusable TypeScript/Laya runtime mechanisms only: lifecycle, asset/package/router/UI/event/timer/update/pool/entity/FSM/module/network/storage/log/crash/performance/WASM/error/Laya integration and focused tests.

Concrete game routes, controllers, assets, APIs and gameplay remain game-owned.

## 3. Server ownership

### `server/go.mod`

Go runtime dependency authority for the reusable server module. It pins the supported Pitaya baseline.

### `server/pitaya/`

Thin Pitaya integration helpers/conventions only. Do not hide the entire Pitaya API behind a second framework API, and do not place game business logic here.

### `server/storage/` and `server/deploy/`

`storage/` owns PostgreSQL connection setup and transactional SQL migration execution, including the shared migration-history DDL. `deploy/` owns the pinned local PostgreSQL Compose deployment and env template. Games supply private environment values and their own domain migrations; they do not copy this infrastructure source.

Further generic server packages may be added only when proven reusable, for example:

```text
server/
├── platform/       provider/auth primitives
├── storage/        generic PostgreSQL primitives
├── commercial/     idempotency/order/reward transaction primitives
└── realtime/       only after a real Go realtime game needs shared code
```

A future Rust GameServer foundation is added only when a real game requires it; there is no empty Rust server skeleton today.

## 4. Shared machine-level tool home

`tooling/install.mjs` installs code-generation tools once per machine.

```text
~/.game-framework/tools/
├── luban/<version>/
├── node/<version-set>/
└── protobuf/go/protoc-gen-go-<version>/bin/
```

Go, Node/npm and .NET remain normal machine toolchains.

## 5. Tooling ownership

### `tooling/toolchain.json`
Machine-tool/code-generator version authority.

### `tooling/install.mjs`
Idempotent machine-level installer for Luban and PB codegen dependencies.

### `tooling/go/`
Go module/test validation for consuming games.

### `tooling/luban/`
Luban validation/generation. Default language outputs are TypeScript + Go plus one binary data set; a game can opt into Rust output only when it owns a Rust consumer.

### `tooling/protobuf/`
One `.proto` source tree generates TypeScript and Go today. Rust codegen is deliberately not part of the baseline until a Rust protocol consumer is introduced.

### `tooling/scripts/`
Aggregate `generate-all.mjs` / `validate-all.mjs` commands.

## 6. Consuming game layout

```text
game-repo/
├── framework/                  # game-framework Git submodule
├── game-tools.json
├── client/
│   └── generated/protocol/
├── server/
│   ├── go.mod
│   ├── cmd/
│   ├── app/
│   ├── domain/
│   ├── storage/
│   ├── platform/
│   └── generated/protocol/
├── shared/
│   └── protocol/
├── data/
│   ├── Datas/
│   ├── luban.conf
│   └── generated/
└── docs/
```

If a game later needs a heavy Rust GameServer, it may add a game-owned Rust module/process beside the Go server. Do not force that shape on games that do not need it.

Dependency direction:

```text
client/server/shared -> framework
framework -X-> concrete game
```

## 7. Ownership invariant

Framework owns reusable runtime source, dependency baselines, generation/validation logic and machine-level codegen tooling.

Games own business source, schemas/migrations, concrete messages/config data, gameplay and deployment secrets.
