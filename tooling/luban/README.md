# Luban Tooling

Shared Luban validation and generation for all games.

The first implementation deliberately follows BounceBall's proven convention:

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

Commands, run from a game repository containing `game-tools.json`:

```bash
node framework/tooling/luban/validate.mjs
node framework/tooling/luban/generate.mjs
```

The framework owns the invocation, validation, output convention and tool resolution. The game owns `luban.conf`, spreadsheets/schema and generated game data.

Do not put concrete game tables in this directory.
