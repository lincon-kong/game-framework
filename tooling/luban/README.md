# Luban Tooling

Shared Luban validation and generation for all games.

Current baseline: `Luban 4.10.2`.

Framework owns the Luban version, committed distribution and invocation. The executable distribution lives at:

```text
tooling/luban/vendor/
├── LICENSE
└── Luban/
    ├── Luban.dll
    └── ...
```

There is no runtime download or per-game Luban copy. Updating Luban means updating this committed Framework directory and the version in `tooling/toolchain.json` together.

Games own only `luban.conf`, schemas/spreadsheets/content, output locations, selected output languages, and the Go import module required by `go-bin`.

Default game configuration generates:

```text
data/generated/
├── typescript-bin/
├── go-bin/
└── bin/
```

A game enabling Go output must configure:

```json
"goModule": "example-game/server/generated/config"
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
