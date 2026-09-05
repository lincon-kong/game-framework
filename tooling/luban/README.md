# Luban Tooling

Shared Luban validation and generation for all games.

## Ownership

Framework owns the Luban version, complete release distribution, runtime DLL dependencies, license and invocation scripts.

Current baseline:

```text
Luban 4.10.2
```

A game must not carry a second `tools/luban/Luban` distribution or choose a different Luban version.

## Install once

```bash
node framework/tooling/install.mjs
```

The pinned Luban release is downloaded once and checksum-validated into:

```text
~/.game-framework/tools/luban/4.10.2/
├── Luban/
│   ├── Luban.dll
│   ├── Luban.Core.dll
│   ├── Luban.Rust.dll
│   ├── Luban.Typescript.dll
│   ├── Google.Protobuf.dll
│   ├── ExcelDataReader.dll
│   └── ... complete release dependencies
└── LICENSE
```

All games using this Framework baseline reuse that installation.

## Game source/output convention

The initial convention follows BounceBall:

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

## Commands

From the game root:

```bash
node framework/tooling/luban/validate.mjs
node framework/tooling/luban/generate.mjs
```

The game owns only `luban.conf`, spreadsheets/schema/content and generated game output. Tool/version/runtime dependencies are shared Framework-owned dependencies.

Do not put concrete game tables in this directory.
