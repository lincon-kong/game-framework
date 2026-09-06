# Go Server Validation

The Framework does not install Go itself. `doctor.mjs` requires the supported Go baseline and `validate.mjs` runs the consuming game's real Go tests.

From a game root:

```bash
node framework/tooling/go/validate.mjs
```

Configuration:

```json
{
  "server": {
    "enabled": true,
    "modulePath": "server"
  }
}
```

Validation runs:

```bash
go test ./...
```

Pitaya runtime dependencies are pinned by Framework `server/go.mod`; concrete game server packages remain game-owned.
