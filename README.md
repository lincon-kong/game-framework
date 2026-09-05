# Game Framework

Reusable client/server game infrastructure shared by multiple games.

## Scope

This repository owns generic runtime and tooling only. It must not contain game-specific rules, content, protocol messages, configuration data, or presentation logic.

## Planned layout

```text
game-framework/
├── client/          # reusable Laya/TypeScript client framework
├── server/          # reusable Rust server foundation (added when needed)
├── tooling/         # shared build/codegen helpers
├── docs/
└── AGENTS.md
```

## Dependency rule

```text
Game repositories -> game-framework
```

`game-framework` never depends on a specific game repository.

## Client framework boundary

Typical framework capabilities include lifecycle, package loading, routing, assets, UI runtime, events, timers, update scheduling, pooling, generic entity/runtime support, crash/logging, generic network transport, storage primitives, WASM runtime and engine adapters.

Game-specific systems such as battle rules, player progression, quests, activities, economy, concrete protobuf messages, Luban game data and game UI remain in the game repository.

## Development model

During active development a game may compile framework source directly. A game release pins an exact framework Git commit/tag so historical builds remain reproducible.

## Status

Initial repository bootstrap. The first consumer is Bounce Ball. Existing framework code will be migrated without moving Bounce Ball business code into this repository.
