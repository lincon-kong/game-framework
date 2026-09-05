# Luban Tooling

Shared Luban validation and generation for all games.

## Ownership

Framework owns the complete Luban tool distribution, runtime DLL dependencies, license, version and invocation scripts.

Current baseline:

```text
Luban 4.10.2
```

Expected Framework layout after bootstrap/vendor sync:

```text
framework/tooling/luban/
├── Luban/
│   ├── Luban.dll
│   ├── Luban.Core.dll
│   ├── Luban.Rust.dll
│   ├── Luban.Typescript.dll
│   ├── Google.Protobuf.dll
│   ├── ExcelDataReader.dll
│   └── ... complete release dependencies
├── LICENSE
├── generate.mjs
├── validate.mjs
└── README.md
```

A game must not carry a second `tools/luban/Luban` distribution or choose a different Luban version.

## Game source/output convention

The first implementation follows BounceBall's proven convention:

```text
Game source
├── data/luban.conf
└── data/Datas/

Generated
└── data/generated/
    ├── typescript-bin/
    ├── rust-bin/
    └── bin/
```

One Luban source produces TypeScript readers, Rust readers and one shared binary data set.

## Setup and commands

```bash
node framework/tooling/bootstrap.mjs

cd <game-root>
node framework/tooling/luban/validate.mjs
node framework/tooling/luban/generate.mjs
```

The game owns only `luban.conf`, spreadsheets/schema/content and generated game output. Tool/version/runtime dependencies stay in Framework.

Do not put concrete game tables in this directory.
