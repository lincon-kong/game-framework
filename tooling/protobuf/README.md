# Protobuf Tooling

Shared Protobuf validation and code generation for explicit protocol boundaries.

## Ownership

Framework owns the PB compiler/codegen dependencies and their versions. A game owns only one `.proto` source tree and generated output locations.

```text
Game
└── shared/protocol/**/*.proto

Framework
├── grpc-tools / protoc
├── ts-proto
├── prost-build
├── protoc-bin-vendored
└── generate/validate scripts
```

Framework tooling generates both sides from the same game-owned source:

```text
.proto
├── TypeScript via Framework grpc-tools + ts-proto
└── Rust via Framework prost-build + protoc-bin-vendored
```

No system `protoc` installation and no game-local generator packages are required.

## Setup and commands

```bash
node framework/tooling/bootstrap.mjs

cd <game-root>
node framework/tooling/protobuf/validate.mjs
node framework/tooling/protobuf/generate.mjs
```

Rust generation requires the Rust/Cargo toolchain because the Framework's Rust generator is a Cargo crate. The PB generator dependencies themselves remain Framework-owned.

Do not create separate client/server copies of the same `.proto`. Do not use PB as a wrapper around direct SpacetimeDB reducers/subscriptions; SpacetimeDB generated client bindings are already the direct typed contract for that path.

BounceBall currently has no concrete `.proto` source, so this Framework layer defines the shared toolchain only. Concrete messages are added to the game repository when the first independent PB boundary is implemented.
