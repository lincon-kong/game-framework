# Protobuf Tooling

Shared Protobuf validation and code generation for explicit protocol boundaries.

## Ownership

Framework owns PB compiler/codegen/runtime dependencies and their versions. A game owns only one `.proto` source tree and generated output locations.

```text
Game
└── shared/protocol/**/*.proto

Framework baseline
├── grpc-tools / protoc
├── ts-proto
├── @bufbuild/protobuf runtime
├── prost-build
└── protoc-bin-vendored
```

One source generates both sides:

```text
.proto
├── TypeScript via shared grpc-tools + ts-proto
└── Rust via shared compiled prost-build generator
```

## Install once

```bash
node framework/tooling/install.mjs
```

The machine-level installer:

- installs the Node PB tools/runtime once into `~/.game-framework/tools/node/...`;
- compiles the Rust PB generator once into `~/.game-framework/tools/protobuf/rust/...`;
- reuses both across all games using the same Framework baseline.

When TypeScript PB output is generated, Framework creates a lightweight game link to the shared `@bufbuild/protobuf` runtime. No per-game PB `npm install`, system `protoc`, or repeated Rust generator build is required.

## Commands

From the game root:

```bash
node framework/tooling/protobuf/validate.mjs
node framework/tooling/protobuf/generate.mjs
```

The machine still needs the base Rust/Cargo toolchain for the one-time installer to compile the shared Rust generator.

Do not create separate client/server copies of the same `.proto`. Do not use PB as a wrapper around direct SpacetimeDB reducers/subscriptions.

BounceBall currently has no concrete `.proto` source; concrete messages are added only when the first independent PB boundary is implemented.
