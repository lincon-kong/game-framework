# Protobuf Tooling

Shared Protobuf validation and code generation for explicit protocol boundaries.

Framework owns compiler/generator versions. A game owns one `.proto` source tree and generated output locations.

Current baseline:

```text
.proto
├── TypeScript via grpc-tools + ts-proto
└── Go via protoc-gen-go
```

`protoc-gen-go` is installed once into the Framework shared tool cache. Go messages should define an appropriate `option go_package` for their game/server module.

Install once:

```bash
node framework/tooling/install.mjs
```

Generate/validate:

```bash
node framework/tooling/protobuf/validate.mjs
node framework/tooling/protobuf/generate.mjs
```

Rust PB codegen is intentionally not in the default toolchain. Add it when the first real Rust protocol consumer exists rather than forcing Rust/Cargo onto every Go-backend development machine.
