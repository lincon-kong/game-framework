# Development and Versioning

This document defines how Framework and game repositories are developed together.

## 1. Repository model

```text
game-framework.git
bounce-ball.git
```

Recommended local shape:

```text
bounce-ball/
├── framework/       # game-framework Git submodule
├── game-tools.json
├── client/
├── server/
├── shared/
└── data/
```

Goal: **multi-repository in Git, monorepo-like in the local editor/build**.

## 2. Framework commit is the dependency lock

A released game pins an exact Framework commit/tag. That pointer pins Framework source, `server/go.mod` runtime baselines and `tooling/toolchain.json` codegen/tool baselines.

Do not automatically follow Framework `master` in released builds.

## 3. Game-owned content

Keep in the game:

- concrete game rules/features;
- Go application/domain code;
- database schemas/migrations;
- platform app IDs/secrets/product definitions;
- concrete PB messages;
- concrete Luban schemas/tables/content;
- presentation/UI;
- game-specific WASM/Rust GameCore behavior;
- game-specific paths in `game-tools.json`.

Framework owns reusable mechanisms and dependency/tool baselines.

## 4. Go server development

Framework server baseline:

```text
Go >= 1.25
Pitaya v2.11.24
```

A consuming game normally owns its own `server/go.mod` and references the Framework server module. With a checked-out Framework submodule, local development may use a `replace` directive or `go.work`; released builds still pin the exact Framework repository commit.

Pitaya standalone mode is the default local path. Do not require etcd/NATS for local development unless the game is explicitly testing cluster behavior.

Typical server validation:

```bash
go test ./...
```

The aggregate Framework command runs the same check when the `server` section is enabled in `game-tools.json`.

## 5. Install once per machine

```bash
node framework/tooling/install.mjs
node framework/tooling/doctor.mjs
```

Shared codegen cache:

```text
~/.game-framework/tools/
├── luban/<version>/
├── node/<version-set>/
└── protobuf/go/protoc-gen-go-<version>/bin/
```

Go itself is not downloaded by Framework; install a supported Go toolchain normally.

## 6. Generated code/data

Generated output is never manually edited.

```text
Luban source
    -> TypeScript readers
    -> Go readers
    -> shared binary data

Game .proto
    -> TypeScript
    -> Go
```

Rust output is opt-in only when a real Rust consumer exists.

Do not create independent client/server schema copies.

## 7. Daily generation/validation

From the consuming game root:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Individual commands:

```bash
node framework/tooling/luban/generate.mjs
node framework/tooling/protobuf/generate.mjs
node framework/tooling/go/validate.mjs
```

## 8. Commercial/server testing

Prefer tests around the real failure boundaries:

- provider login verification;
- payment signatures/callback replay;
- idempotent order/reward settlement;
- PostgreSQL transaction rollback;
- session/reconnect behavior;
- protocol compatibility.

Do not fill Framework with generic mock-heavy layers that exist only to satisfy an architecture diagram.

## 9. Future Rust GameServer

When a game proves it needs heavier realtime performance, add Rust as a separate GameServer process or game-owned module.

The stable contract should be narrow:

```text
Go -> allocation/join token/control
Client <-> Rust -> realtime gameplay
Rust -> Go -> authenticated match result
```

Do not move payment/mail/activity/account logic into Rust simply because battle simulation uses Rust.

## 10. Upgrades

- Go/Pitaya runtime dependency upgrades happen in Framework `server/go.mod`.
- Luban/PB generator upgrades happen in `tooling/toolchain.json`.
- Validate Framework first, then deliberately move each game's Framework pointer.
- Prefer released Pitaya versions over tracking `main`.

## 11. Versioning

While Framework is being established, exact Git commits are sufficient.

Once released games stabilize the baseline:

```text
PATCH  bug fix / behavior-preserving optimization
MINOR  backward-compatible capability/dependency update
MAJOR  intentional breaking contract/semantic change
```
