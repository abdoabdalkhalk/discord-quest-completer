import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/solve.js";
import { desktopProblems, readProgress, resolveIdentity } from "../lib/discord.js";
import { startMockDiscord } from "./mock-discord.mjs";

const TOKEN = "mock.user.token";
const APP_ID = "1111111111111111";
const QUEST_ID = "1234567890123456";

const webSp = {
  os: "Windows",
  browser: "Chrome",
  browser_user_agent: "Mozilla/5.0 test Chrome/1.0",
  system_locale: "en-US",
  client_build_number: 100,
};

const desktopSp = {
  os: "Windows",
  browser: "Discord Client",
  client_version: "1.0.0",
  native_build_number: 1,
  client_build_number: 100,
  system_locale: "en-US",
  browser_user_agent: "Mozilla/5.0 discord/1.0.0 Chrome/1 Electron/1 Safari/537.36",
  launch_signature: "kept-as-captured",
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

function call(body) {
  return new Promise((resolve) => {
    const listeners = [];
    const res = {
      writableEnded: false,
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.writableEnded = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      on(name, fn) {
        listeners.push([name, fn]);
      },
    };
    handler({ method: "POST", body }, res);
  });
}

let mock;

before(async () => {
  process.env.SOLVE_HEARTBEAT_INTERVAL_MS = "150";
  process.env.SOLVE_GATEWAY_SETTLE_MS = "50";
  process.env.SOLVE_MAX_SECONDS = "20";
});

after(async () => {
  if (mock) await mock.close();
});

async function useMock(opts) {
  if (mock) await mock.close();
  mock = await startMockDiscord({ validToken: TOKEN, applicationId: APP_ID, targetSeconds: 100, ...opts });
  process.env.DISCORD_API_BASE = `http://127.0.0.1:${mock.port}/api/v9`;
  process.env.DISCORD_GATEWAY_URL = `ws://127.0.0.1:${mock.port}/`;
}

const base = () => ({
  token: TOKEN,
  super_properties: b64(webSp),
  quest_id: QUEST_ID,
  application_id: APP_ID,
  task_type: "PLAY_ON_DESKTOP",
  seconds_needed: 100,
  seconds_done: 0,
  budget_seconds: 20,
});

test("pure helpers", () => {
  assert.deepEqual(desktopProblems(null), ["value is not base64 JSON"]);
  assert.deepEqual(desktopProblems(desktopSp), []);
  assert.ok(desktopProblems(webSp).length > 0);
  assert.deepEqual(readProgress({ progress: { PLAY_ON_DESKTOP: { value: 40 } } }, ["PLAY_ON_DESKTOP"]), {
    value: 40,
    completed: false,
  });
  assert.equal(readProgress({ user_status: { completed_at: "x" } }, ["PLAY_ON_DESKTOP"]).completed, true);
  const id = resolveIdentity(b64(webSp), b64(desktopSp));
  assert.equal(id.kind, "desktop");
  assert.equal(id.sp.launch_signature, "kept-as-captured");
  assert.throws(() => resolveIdentity(b64(webSp), b64({ browser: "Chrome" })));
});

test("completes when presence and desktop identity are present", async () => {
  await useMock({ requireDesktop: true, requirePresence: true });
  const r = await call({ ...base(), desktop_super_properties: b64(desktopSp) });
  assert.equal(r.body.status, "completed", JSON.stringify(r.body));
  assert.equal(r.body.diagnostic.identity, "desktop");
  assert.equal(r.body.diagnostic.gateway.state, "ready");
  assert.equal(r.body.diagnostic.variant, "app");
  assert.equal(r.body.diagnostic.application.name, "Mock Game");
  assert.equal(mock.log.identifies[0].presence.activities[0].name, "Mock Game");
  assert.equal(mock.log.upgrades[0].origin, "https://discord.com");
  assert.ok(mock.log.heartbeats.every((h) => !("stream_key" in h.body)));
});

test("web identity is rejected when the server requires desktop", async () => {
  await useMock({ requireDesktop: true, requirePresence: false });
  const r = await call(base());
  assert.equal(r.body.status, "auth_rejected");
  assert.equal(r.body.diagnostic.identity, "web");
  assert.equal(r.body.diagnostic.attempts.length, 2);
});

test("missing presence is rejected, then the gateway makes it pass", async () => {
  await useMock({ requireDesktop: false, requirePresence: true });
  const ok = await call(base());
  assert.equal(ok.body.status, "completed", JSON.stringify(ok.body));
});

test("gateway failure with a bad token is reported and heartbeats still go out", async () => {
  await useMock({ requireDesktop: false, requirePresence: false });
  const r = await call({ ...base(), token: "wrong" });
  assert.equal(r.body.status, "auth_rejected");
  assert.equal(r.body.diagnostic.gateway.state, "failed");
});

test("input validation", async () => {
  await useMock({});
  assert.equal((await call({ ...base(), quest_id: "../x" })).status, 400);
  assert.equal((await call({ ...base(), application_id: "abc" })).status, 400);
  assert.equal((await call({ ...base(), task_type: "WATCH_VIDEO" })).status, 400);
  assert.equal((await call({ ...base(), token: "" })).status, 400);
});

test("partial chunk returns in_progress and keeps progress", async () => {
  await useMock({ requireDesktop: false, requirePresence: true });
  const r = await call({ ...base(), seconds_needed: 100, budget_seconds: 5 });
  assert.ok(["in_progress", "completed"].includes(r.body.status), JSON.stringify(r.body));
  assert.ok(r.body.current >= 20);
});
