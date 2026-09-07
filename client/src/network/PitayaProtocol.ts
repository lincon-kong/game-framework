export interface PitayaMessage {
  readonly type: number;
  readonly id: number;
  readonly route: string;
  readonly error: boolean;
  readonly body: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

// Pitaya's built-in protos.Error is independent of each game's schema.
export function decodeRemoteError(data: Uint8Array): { code: string; msg: string; metadata: Record<string, string> } {
  const fields = (bytes: Uint8Array, consume: (field: number, value: Uint8Array) => void): void => {
    let offset = 0;
    const varint = (): number => {
      let value = 0;
      let scale = 1;
      for (let i = 0; i < 10; i++) {
        if (offset >= bytes.length) throw new Error("Truncated Protobuf error.");
        const byte = bytes[offset++];
        value += (byte & 127) * scale;
        if ((byte & 128) === 0) return value;
        scale *= 128;
      }
      throw new Error("Invalid Protobuf varint.");
    };
    while (offset < bytes.length) {
      const tag = varint();
      if (!Number.isSafeInteger(tag) || tag < 8 || tag > 0xffffffff) throw new Error("Invalid Protobuf field tag.");
      const wire = tag % 8;
      if (wire === 0) varint();
      else if (wire === 1) offset += 8;
      else if (wire === 5) offset += 4;
      else if (wire === 2) {
        const length = varint();
        if (!Number.isSafeInteger(length) || length > bytes.length - offset) throw new Error("Truncated Protobuf field.");
        consume(Math.floor(tag / 8), bytes.subarray(offset, offset + length));
        offset += length;
      } else throw new Error("Unsupported Protobuf error wire type.");
      if (offset > bytes.length) throw new Error("Truncated Protobuf error field.");
    }
  };
  const result = { code: "", msg: "", metadata: Object.create(null) as Record<string, string> };
  fields(data, (field, value) => {
    if (field === 1) result.code = decoder.decode(value);
    else if (field === 2) result.msg = decoder.decode(value);
    else if (field === 3) {
      let key = "";
      let entry = "";
      fields(value, (number, text) => {
        if (number === 1) key = decoder.decode(text);
        else if (number === 2) entry = decoder.decode(text);
      });
      result.metadata[key] = entry;
    }
  });
  return result;
}

export function encodePacket(type: number, body = new Uint8Array(0)): Uint8Array {
  if (body.length > 0xffffff) throw new Error("Pitaya packet exceeds the 24-bit size limit.");
  const packet = new Uint8Array(4 + body.length);
  packet.set([type, body.length >>> 16, body.length >>> 8, body.length]);
  packet.set(body, 4);
  return packet;
}

export function decodePacket(data: Uint8Array): { type: number; body: Uint8Array } {
  if (data.length < 4) throw new Error("Truncated Pitaya packet header.");
  const length = data[1] * 65536 + data[2] * 256 + data[3];
  if (data.length !== length + 4) throw new Error("Invalid Pitaya packet length.");
  return { type: data[0], body: data.subarray(4) };
}

export function encodeRequest(type: 0 | 1, id: number, route: string, body: Uint8Array): Uint8Array {
  const routeBytes = encoder.encode(route);
  if (routeBytes.length === 0 || routeBytes.length > 255) throw new Error("Pitaya route must contain 1 to 255 UTF-8 bytes.");
  const header = [type << 1];
  if (type === 0) {
    do {
      const byte = id % 128;
      id = Math.floor(id / 128);
      header.push(byte | (id > 0 ? 128 : 0));
    } while (id > 0);
  }
  header.push(routeBytes.length);
  const data = new Uint8Array(header.length + routeBytes.length + body.length);
  data.set(header);
  data.set(routeBytes, header.length);
  data.set(body, header.length + routeBytes.length);
  return data;
}

export function decodeMessage(data: Uint8Array, routes: ReadonlyMap<number, string>): PitayaMessage {
  let offset = 0;
  const read = (): number => {
    if (offset >= data.length) throw new Error("Truncated Pitaya message.");
    return data[offset++];
  };
  const flag = read();
  if ((flag & 0xd0) !== 0) throw new Error("Unsupported Pitaya message flags; disable server compression.");
  const type = (flag >>> 1) & 7;
  if (type !== 2 && type !== 3) throw new Error("Expected a Pitaya response or push.");
  let id = 0;
  if (type === 2) {
    let scale = 1;
    let byte: number;
    do {
      byte = read();
      id += (byte & 127) * scale;
      if (!Number.isSafeInteger(id) || scale > 2 ** 49) throw new Error("Invalid Pitaya request ID.");
      scale *= 128;
    } while ((byte & 128) !== 0);
    if (id === 0) throw new Error("Pitaya response ID must be positive.");
  }
  let route = "";
  if (type === 3) {
    if ((flag & 1) !== 0) {
      const code = read() * 256 + read();
      const name = routes.get(code);
      if (name === undefined) throw new Error(`Unknown Pitaya route code ${code}.`);
      route = name;
    } else {
      const length = read();
      if (length === 0 || offset + length > data.length) throw new Error("Invalid Pitaya push route.");
      route = decoder.decode(data.subarray(offset, offset + length));
      offset += length;
    }
  }
  return { type, id, route, error: (flag & 32) !== 0, body: data.subarray(offset) };
}
