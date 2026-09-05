# Protobuf Tooling

Shared Protobuf validation and code generation for explicit protocol boundaries.

A game owns one source tree, normally:

```text
shared/protocol/**/*.proto
```

Framework tooling generates both sides from that same source:

```text
.proto
├── TypeScript via ts-proto
└── Rust via prost-build
```

Commands:

```bash
cd framework/tooling && npm install
cd <game-root>
node framework/tooling/protobuf/validate.mjs
node framework/tooling/protobuf/generate.mjs
```

`protoc` must be available on PATH. Rust generation also requires Cargo.

Do not create separate client/server copies of the same `.proto`. Do not use PB as a wrapper around direct SpacetimeDB reducers/subscriptions; SpacetimeDB client bindings are already the direct typed contract for that path.

BounceBall currently has no concrete `.proto` source, so this framework layer defines the toolchain only. Concrete messages should be added to the game repository when the first independent PB boundary is implemented.
