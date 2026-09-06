# Framework Tooling

Shared build/code-generation toolchain used by all game repositories.

## Ownership

- `.go-version` + `tooling/toolchain.json` own the exact Go toolchain policy.
- `server/go.mod` owns shared Go server runtime dependencies such as Pitaya.
- `tooling/luban/vendor/Luban/` contains the committed Luban distribution used by every game.
- `tooling/toolchain.json` owns Protobuf generator/runtime package versions.
- Games own concrete schemas/data/source paths and generation targets, not Framework tool versions.

## Bootstrap generated-code tools

```bash
node framework/tooling/install.mjs
node framework/tooling/doctor.mjs
```

Luban is **not downloaded** by this command. Luban ships with the Framework checkout.

The user-level cache is only for generated-code helpers that are platform-specific or npm/go-installed:

```text
~/.game-framework/tools/
├── node/<version-set>/
└── protobuf/go/protoc-gen-go-<version>/bin/
```

The installer does not install Go, Node or .NET themselves. Current baseline is Node >=18, exact Go `1.26.7`, and .NET 8 for Luban. Rust is optional and only needed by games that actually own Rust/WASM or a future Rust GameServer.

## Current tool baseline

- Go `1.26.7`;
- Luban `4.10.2` committed in Framework;
- Pitaya `2.11.24` through `server/go.mod`;
- ts-proto `2.12.1`;
- @bufbuild/protobuf `2.10.2`;
- grpc-tools/protoc `1.13.1`;
- protoc-gen-go `1.36.11`.

## Per-game configuration

`game-tools.json` describes:

- Go server module path;
- Luban config/output/languages and the game's Go import module for generated config;
- `.proto` source and TypeScript/Go outputs.

It does not select tool versions.

## Unified commands

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Generation covers Luban + Protobuf. Validation covers Luban source, Protobuf source and `go test ./...` for the enabled game server module.

### Luban

Default outputs:

```text
<outputRoot>/typescript-bin
<outputRoot>/go-bin
<outputRoot>/bin
```

A game enabling Go generation must provide `luban.goModule`. Rust is opt-in via the game's `languages` list.

### Protobuf

```text
.proto
├── TypeScript
└── Go
```

Framework generation uses its own pinned `grpc-tools`, `ts-proto` and `protoc-gen-go`; games do not install or version these independently.
