const assert = require("node:assert/strict");
const test = require("node:test");
const { PitayaClient } = require("../dist/network");
const { encodePacket, decodePacket, decodeMessage, decodeRemoteError } = require("../dist/network/PitayaProtocol");

class ControlledSocket {
  readyState = 0;
  sent = [];
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen(); }
  receive(type, body) {
    const packet = encodePacket(type, body);
    this.onmessage({ data: packet.buffer });
  }
  handshake(sys = {}) {
    this.open();
    this.receive(1, Buffer.from(JSON.stringify({ code: 200, sys: { heartbeat: 30, serializer: "protobuf", ...sys } })));
  }
}

function setup(options = {}) {
  const sockets = [];
  const client = new PitayaClient({
    url: "ws://localhost:3250", connectTimeoutMs: 100,
    socketFactory: () => { const socket = new ControlledSocket(); sockets.push(socket); return socket; },
    ...options,
  });
  return { client, sockets };
}

test("packet boundaries, route dictionary and malformed wire data", () => {
  assert.deepEqual(decodePacket(encodePacket(4, new Uint8Array([1, 2]))), { type: 4, body: new Uint8Array([1, 2]) });
  assert.throws(() => decodePacket(new Uint8Array([4, 0, 0, 2, 1])), /length/);
  const push = decodeMessage(new Uint8Array([7, 0, 9, 42]), new Map([[9, "test.push"]]));
  assert.equal(push.route, "test.push");
  assert.equal(push.body[0], 42);
  assert.throws(() => decodeMessage(new Uint8Array([7, 0, 8]), new Map()), /route code/);
  assert.throws(() => decodeMessage(new Uint8Array([4, 128]), new Map()), /Truncated/);
  assert.throws(() => decodeMessage(new Uint8Array([20, 1]), new Map()), /compression/);
  assert.throws(() => decodeRemoteError(new Uint8Array([10, 10, 65])), /Truncated/);
  const error = decodeRemoteError(Buffer.from([10, 1, 67, 18, 1, 77, 26, 6, 10, 1, 75, 18, 1, 86]));
  assert.equal(error.code, "C");
  assert.equal(error.msg, "M");
  assert.equal(error.metadata.K, "V");
});

test("handshake timeout and non-PB serializer reject connect", async () => {
  const { client, sockets } = setup({ connectTimeoutMs: 15 });
  await assert.rejects(client.connect(), /handshake timed out/);
  assert.equal(sockets[0].readyState, 3);
  const connecting = client.connect();
  sockets[1].handshake({ serializer: "json" });
  await assert.rejects(connecting, /Protobuf serializer/);
  assert.equal(client.status, "Disconnected");
  client.dispose();
});

test("lost heartbeat disconnects and rejects all pending requests", async () => {
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  const { client, sockets } = setup({ onDisconnect: disconnected });
  const connecting = client.connect();
  sockets[0].handshake({ heartbeat: 0.01 });
  await connecting;
  const pending = assert.rejects(client.requestBytes("test.request", new Uint8Array()), /heartbeat timed out/);
  assert.match((await closed).message, /heartbeat timed out/);
  await pending;
  assert.equal(client.status, "Disconnected");
  client.dispose();
});

test("control-packet send failures reject connection work", async () => {
  const { client, sockets } = setup();
  let connecting = client.connect();
  sockets[0].send = () => { throw new Error("handshake send failure"); };
  sockets[0].open();
  await assert.rejects(connecting, /handshake send failure/);
  connecting = client.connect();
  sockets[1].handshake({ heartbeat: 0.01 });
  await connecting;
  const pending = client.requestBytes("test.request", new Uint8Array());
  sockets[1].send = () => { throw new Error("heartbeat send failure"); };
  await assert.rejects(pending, /heartbeat send failure/);
  assert.equal(client.status, "Disconnected");
  connecting = client.connect();
  client.dispose();
  await assert.rejects(connecting, /disposed/);
});

test("abort before send, malformed packets and stale socket events", async () => {
  const { client, sockets } = setup();
  let connecting = client.connect();
  sockets[0].handshake();
  await connecting;
  const abort = new AbortController();
  abort.abort();
  const sent = sockets[0].sent.length;
  await assert.rejects(client.requestBytes("test.request", new Uint8Array(), { signal: abort.signal }), /aborted/);
  assert.equal(sockets[0].sent.length, sent);
  const oldMessage = sockets[0].onmessage;
  const pending = assert.rejects(client.requestBytes("test.request", new Uint8Array()), /length/);
  sockets[0].onmessage({ data: new Uint8Array([4, 0, 0, 1]).buffer });
  await pending;
  connecting = client.connect();
  sockets[1].handshake();
  await connecting;
  oldMessage({ data: encodePacket(5).buffer });
  assert.equal(client.status, "Connected");
  client.dispose();
  client.dispose();
  assert.equal(client.status, "Disposed");
});
