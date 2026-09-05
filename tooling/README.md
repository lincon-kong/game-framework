# Framework Tooling

Shared build/code-generation helpers that are generic across games.

Planned ownership:

```text
tooling/
├── protobuf/   generic Protobuf generation/check helpers
├── luban/      generic Luban invocation/generation/validation helpers
└── scripts/    repository-wide developer/CI helpers
```

Concrete game `.proto` files, Luban schemas/tables and generated game data remain in the game repository.

Do not create custom tooling when standard npm/Cargo/Luban/protoc tooling already solves the problem cleanly.
