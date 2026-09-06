# Framework Tooling

Shared build/code-generation toolchain used by all game repositories.

## Ownership

- `server/go.mod` owns Go server runtime dependency versions such as Pitaya.
- `tooling/toolchain.json` owns machine/code-generation tool versions.
- Games own concrete schemas/data/source paths, not Framework tool versions.

## Install once

```bash
node framework/tooling/install.mjs
node framework/tooling/doctor.mjs
```

Default shared root:

```text
~/.game-framework/tools/
├── luban/<version>/
├── node/<version-set>/
└── protobuf/go/protoc-gen-go-<version>/bin/
```

The installer does not install Go, Node or .NET themselves. Doctor requires Node >=18, Go >=1.25 and .NET 8 for the current baseline. Rust is optional and only needed by games that actually own Rust/WASM or a future Rust GameServer.

## Current tool baseline

- Luban `4.10.2`;
- ts-proto `2.12.1`;
- @bufbuild/protobuf `2.10.2`;
- grpc-tools/protoc `1.13.1`;
- protoc-gen-go `1.36.11`.

## Per-game configuration

`game-tools.json` describes:

- Go server module path;
- Luban config/output/languages;
- `.proto` source and TypeScript/Go outputs.

It does not select tool versions.

## Unified commands

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Generation currently covers Luban + Protobuf. Validation covers Luban source, Protobuf source and `go test ./...` for the enabled game server module.

### Luban

Default outputs:

```text
<outputRoot>/typescript-bin
<outputRoot>/go-bin
<outputRoot>/bin
```

Rust is opt-in via the game's `languages` list.

### Protobuf

```text
.proto
├── TypeScript
└── Go
```

No system `protoc` or global `protoc-gen-go` is used by Framework generation.
