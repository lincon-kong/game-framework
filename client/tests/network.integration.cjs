const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { PitayaClient, PitayaRemoteError } = require("../dist/network");
const { decodeRemoteError } = require("../dist/network/PitayaProtocol");

// Reuse Pitaya's existing Error message as a transport fixture; no game schema is needed.
const codec = {
  encode({ code = "", msg = "" }) {
    const fields = [];
    for (const [tag, value] of [[10, code], [18, msg]]) {
      const bytes = Buffer.from(value);
      assert.ok(bytes.length < 128);
      fields.push(Buffer.from([tag, bytes.length]), bytes);
    }
    return { finish: () => Buffer.concat(fields) };
  },
  decode: decodeRemoteError,
};

async function main() {
  const client = new PitayaClient({ url: process.argv[2], requestTimeoutMs: 2000 });
  const second = new PitayaClient({ url: process.argv[2] });
  const request = (value, options) => client.request("network.test.echo", value, codec, codec, options);
  try {
    await Promise.all([client.connect(), client.connect(), second.connect()]);
    assert.equal(client.status, "Connected");
    const replies = await Promise.all(Array.from({ length: 130 }, (_, i) => request({ code: "echo", msg: `消息-${i}` })));
    replies.forEach((reply, i) => assert.equal(reply.msg, `消息-${i}`));
    await assert.rejects(request({ code: "fail" }), error => error instanceof PitayaRemoteError && error.message === "network test rejection");
    await assert.rejects(request({ code: "slow" }, { timeoutMs: 20 }), /timed out/);
    const abort = new AbortController();
    const aborted = request({ code: "slow" }, { signal: abort.signal });
    abort.abort();
    await assert.rejects(aborted, /aborted/);
    await delay(200);
    assert.equal((await request({ msg: "after late replies" })).msg, "after late replies");

    let unsubscribe;
    const push = new Promise(resolve => { unsubscribe = client.onPush("network.push", codec, resolve); });
    client.notify("network.test.notify", { msg: "真实推送" }, codec);
    assert.equal((await push).msg, "真实推送");
    unsubscribe();

    await delay(3200);
    assert.equal((await request({ msg: "heartbeat alive" })).msg, "heartbeat alive");
    await assert.rejects(request({ code: "close" }), /closed|transport failed/);
    assert.equal(client.status, "Disconnected");
    assert.equal(second.status, "Connected");
    await client.connect();
    assert.equal((await request({ msg: "reconnected" })).msg, "reconnected");

    const pending = request({ code: "slow" });
    client.dispose();
    await assert.rejects(pending, /disposed/);
    assert.throws(() => client.connect(), /disposed/);
    console.log("PASS: real WS/PB handshake, 130 correlated requests, PB errors, timeout, abort, late replies, notify/push, heartbeat, independent connections, reconnect and disposal");
  } finally {
    client.dispose();
    second.dispose();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
