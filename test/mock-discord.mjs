import http from "node:http";
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(state, chunk, onText, onClose) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  for (;;) {
    const buf = state.buffer;
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return;
      length = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + length) return;
    const mask = masked ? buf.subarray(offset, offset + 4) : null;
    const data = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + length));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    state.buffer = buf.subarray(offset + maskLen + length);
    if (opcode === 1) onText(data.toString("utf8"));
    else if (opcode === 8) onClose();
  }
}

export function startMockDiscord({ validToken, applicationId, targetSeconds, requireDesktop, requirePresence, stepSeconds = 20 }) {
  const sessions = new Map();
  const log = { heartbeats: [], upgrades: [], identifies: [], presences: [] };
  let progress = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const auth = req.headers.authorization;
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (auth !== validToken) return send(401, { message: "401: Unauthorized", code: 0 });

    if (req.method === "GET" && url.pathname === "/api/v9/applications/public") {
      return send(200, [{ id: applicationId, name: "Mock Game" }]);
    }

    if (req.method === "GET" && url.pathname === "/api/v9/quests/@me") {
      return send(200, {
        quests: [
          {
            id: "1234567890123456",
            config: { task_config: { tasks: { PLAY_ON_DESKTOP: { target: targetSeconds } } } },
            user_status: { progress: { PLAY_ON_DESKTOP: { value: progress } } },
          },
        ],
      });
    }

    if (req.method === "POST" && /^\/api\/v9\/quests\/\d+\/heartbeat$/.test(url.pathname)) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const sp = JSON.parse(Buffer.from(req.headers["x-super-properties"], "base64").toString("utf8"));
        log.heartbeats.push({ body, browser: sp.browser, ua: req.headers["user-agent"] });
        if (requireDesktop && sp.browser !== "Discord Client") {
          return send(401, { message: "401: Unauthorized", code: 40001 });
        }
        if (requirePresence) {
          const hasPresence = [...sessions.values()].some(
            (s) => s.open && s.presenceApp === body.application_id,
          );
          if (!hasPresence) return send(401, { message: "401: Unauthorized", code: 40001 });
        }
        if (body.application_id !== applicationId) return send(400, { message: "bad application" });
        progress += stepSeconds;
        const completed = progress >= targetSeconds;
        send(200, {
          quest_id: "1234567890123456",
          progress: { PLAY_ON_DESKTOP: { value: Math.min(progress, targetSeconds) } },
          completed_at: completed ? new Date().toISOString() : null,
        });
      });
      return;
    }

    send(404, { message: "not found" });
  });

  server.on("upgrade", (req, socket) => {
    log.upgrades.push({ origin: req.headers.origin, ua: req.headers["user-agent"] });
    const accept = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const session = { open: true, presenceApp: null };
    const id = `sess-${sessions.size + 1}`;
    sessions.set(id, session);
    const state = { buffer: Buffer.alloc(0) };
    const sendPacket = (p) => socket.write(encodeFrame(JSON.stringify(p)));
    sendPacket({ op: 10, d: { heartbeat_interval: 400 } });
    socket.on("data", (chunk) =>
      decodeFrames(
        state,
        chunk,
        (text) => {
          const p = JSON.parse(text);
          if (p.op === 1) sendPacket({ op: 11 });
          if (p.op === 2) {
            log.identifies.push(p.d);
            if (p.d.token !== validToken) {
              socket.write(Buffer.from([0x88, 2, 0x0f, 0xac]));
              socket.end();
              return;
            }
            const act = p.d.presence && p.d.presence.activities && p.d.presence.activities[0];
            session.presenceApp = act ? act.application_id : null;
            sendPacket({ op: 0, s: 1, t: "READY", d: { session_id: id } });
          }
          if (p.op === 3) {
            log.presences.push(p.d);
            const act = p.d.activities && p.d.activities[0];
            session.presenceApp = act ? act.application_id : null;
          }
        },
        () => {
          session.open = false;
          socket.end();
        },
      ),
    );
    socket.on("close", () => {
      session.open = false;
    });
    socket.on("error", () => {
      session.open = false;
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        log,
        reset: () => {
          progress = 0;
          log.heartbeats.length = 0;
          log.identifies.length = 0;
          log.presences.length = 0;
          log.upgrades.length = 0;
        },
        close: () => new Promise((r) => server.close(r) && server.closeAllConnections()),
      });
    });
  });
}
