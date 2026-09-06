# Luban Tooling

Shared Luban validation and generation for all games.

Current baseline: `Luban 4.10.2`.

Framework owns the Luban version/distribution/invocation. Games own only `luban.conf`, schemas/spreadsheets/content and generated output.

Default game configuration generates:

```text
data/generated/
├── typescript-bin/
├── go-bin/
└── bin/
```

A game with a real Rust consumer may opt in:

```json
"languages": ["typescript", "go", "rust"]
```

which additionally emits `rust-bin/`.

Commands:

```bash
node framework/tooling/luban/validate.mjs
node framework/tooling/luban/generate.mjs
```

Do not put concrete game tables in Framework tooling.
