# Pitaya Integration

Thin integration boundary for the Framework-pinned Pitaya runtime.

Baseline:

```text
Pitaya v2.11.24
Go >= 1.25
```

Rules:

- use standalone mode by default for local development and small deployments;
- game code may use Pitaya APIs directly at handlers/remotes/session/runtime boundaries;
- do not pass Pitaya session/context types deep into business/domain code;
- do not add etcd/NATS merely because Pitaya supports cluster mode;
- introduce cluster mode only when multiple Go nodes/processes actually need discovery/RPC;
- realtime room/game logic may stay in Go while it is simple enough;
- a future heavy Rust GameServer is a separate runtime, not a rewrite of the Go commercial backend.

`NewStandaloneBuilder` is intentionally a very small convenience helper. This package must not grow into a second abstraction layer that mirrors the whole Pitaya API.
