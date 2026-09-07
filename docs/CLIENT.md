# Client Framework

This document defines the reusable client-side architecture.

## 1. Technology baseline

- TypeScript 5.x;
- LayaAir 3.x as the first engine integration target;
- framework core remains engine-agnostic where practical;
- Laya-specific behavior stays behind `laya/` adapters;
- final game builds own final bundling/minification.

The framework must not bundle its own duplicate Laya runtime.

## 2. Core model

```text
Framework
  +-- Lifecycle
  +-- Assets / Packages
  +-- Router / UI
  +-- Events / Timers / Update
  +-- Pools / Entities / FSM
  +-- Modules
  +-- Network / Storage
  +-- Log / Crash / Perf
  +-- WASM
  +-- Engine adapters
```

### Lifecycle ownership

```text
AppScope
  -> PackageScope
      -> RouteScope
          -> RouteScope
```

Every disposable framework resource should be owner-bound when practical. Parent disposal cascades to children and async work must not commit into an inactive owner.

### Network

Client network responsibility is mechanism only:

- HTTP/WebSocket transport;
- request cancellation/timeout;
- heartbeat/reconnect primitives;
- request IDs/correlation;
- generic codec hooks;
- connection state;
- owner-aware cancellation where useful.

**Do not design NetworkManager as one global socket.** The client must support named independent connections, for example:

```text
NetworkManager
├── lobby -> Go / Pitaya
└── game  -> optional realtime GameServer
```

Both sockets may coexist. Lobby traffic remains low-frequency while the game connection carries realtime input/state.

Game-specific auth flows, route names and messages remain in game/application code.

`PitayaClient` in the `network` export provides a standard WebSocket connection to a Protobuf Pitaya server. Each instance owns its socket, handshake deadline, heartbeat, request IDs, pending request deadlines/cancellation and push listeners. Pass generated message codecs to `request`, `notify` and `onPush`. Use the server's `NewStandaloneProtobufBuilder`; it disables message compression and uses PB for runtime errors as well as handler messages. Pitaya's JSON control handshake is unchanged.

The creator owns disposal. `disconnect()` rejects pending work and permits a later explicit `connect()`; `dispose()` also clears listeners and permanently prevents reuse. Reconnection does not restore game authentication or replay requests. Local timeout/abort cannot undo server work; games resolve uncertain mutations through their own idempotency protocol. `onDisconnect` reports the reason. Multiple clients can coexist without shared connection state. The default runtime requires standard `WebSocket`, `TextEncoder` and `TextDecoder`; `socketFactory` permits an equivalent platform socket adapter.

Run `npm --prefix client run test:network` in the Framework repository for focused protocol/lifecycle tests. After building the client, run `FRAMEWORK_NETWORK_TEST=1 go test ./pitaya -run TestWebSocketProtobufIntegration -count=1` from `server` for the real Node WebSocket/Go Protobuf transport test. This transport test uses only test handlers and does not need PostgreSQL.

Recommended game-facing boundary:

```text
Feature
  -> application service / backend client
      -> framework transport
```

### Update scheduling

Framework exposes named phases such as `PreUpdate`, `NetworkUpdate`, `FixedUpdate`, `Update`, `LateUpdate` and `RenderUpdate`. Fixed-step policy is configurable by the consuming game.

### Storage

Framework provides client storage mechanisms. Local storage is never authoritative for paid currency, inventory or other server-owned commercial state.

### WASM

Framework owns generic WASM loading/memory/call adapter mechanisms only. Concrete game WASM modules and ABI semantics remain game-owned.

## 3. What must not be added here

Do not add concrete game controllers/models/views, route IDs, gameplay rules, platform payment behavior, concrete PB messages/Luban tables, or game-specific WASM ABI definitions.

## 4. Promotion rule

Prefer implementing a capability in a game first, then extracting it after repeated usage or when it is clearly a generic runtime mechanism. Avoid speculative framework growth.
