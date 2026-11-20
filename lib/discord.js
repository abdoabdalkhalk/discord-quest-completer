import { randomUUID } from "node:crypto";

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/157.0.0.0 Safari/537.36";

export const PLAY_TASKS = ["PLAY_ON_DESKTOP", "PLAY_ON_DESKTOP_V2"];
export const STREAM_TASKS = ["STREAM_ON_DESKTOP"];

const SNOWFLAKE_RE = /^\d{5,25}$/;

export function apiBase() {
  return process.env.DISCORD_API_BASE || "https://discord.com/api/v9";
}

export function gatewayUrl() {
  return process.env.DISCORD_GATEWAY_URL || "wss://gateway.discord.gg/?v=9&encoding=json";
}

export function isSnowflake(value) {
  if (typeof value !== "string" && typeof value !== "number") return false;
  return SNOWFLAKE_RE.test(String(value));
}

export function decodeSuperProperties(b64) {
  if (typeof b64 !== "string" || !b64.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    try {
      const parsed = JSON.parse(Buffer.from(b64.trim(), "base64url").toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed;
    } catch (e2) {
      return null;
    }
  }
}

export function encodeSuperProperties(sp) {
  return Buffer.from(JSON.stringify(sp), "utf8").toString("base64");
}

export function desktopProblems(sp) {
  if (!sp) return ["value is not base64 JSON"];
  const problems = [];
  if (sp.browser !== "Discord Client") problems.push('browser is not "Discord Client"');
  if (typeof sp.client_version !== "string" || !sp.client_version) problems.push("client_version is missing");
  if (!Number.isFinite(sp.native_build_number)) problems.push("native_build_number is missing");
  if (!Number.isFinite(sp.client_build_number)) problems.push("client_build_number is missing");
  if (typeof sp.browser_user_agent !== "string" || !/Electron\//.test(sp.browser_user_agent)) {
    problems.push("browser_user_agent has no Electron token");
  }
  return problems;
}

function fillLaunchFields(sp) {
  if (!sp.client_launch_id) sp.client_launch_id = randomUUID();
  if (!sp.launch_signature) sp.launch_signature = randomUUID();
  if (!sp.client_heartbeat_session_id) sp.client_heartbeat_session_id = randomUUID();
  if (!sp["x-installation-id"]) sp["x-installation-id"] = randomUUID();
  if (sp.has_client_mods === undefined) sp.has_client_mods = false;
  return sp;
}

const SP_BROWSER_ERROR =
  "Super Properties were captured from a web browser. This tool requires " +
  "Super Properties from the Discord desktop app (browser must be 'Discord Client'). " +
  "Open the Discord desktop app, press Ctrl+Shift+I, run the SP snippet in its Console, " +
  "and paste the resulting value.";

export function resolveIdentity(webB64, desktopB64) {
  const web = decodeSuperProperties(webB64);
  if (!web) throw new Error("Invalid Super Properties");

  if (web.browser !== "Discord Client") {
    throw new Error(SP_BROWSER_ERROR);
  }

  let sp = web;
  let kind = "desktop";

  if (typeof desktopB64 === "string" && desktopB64.trim()) {
    const desktop = decodeSuperProperties(desktopB64);
    const problems = desktopProblems(desktop);
    if (problems.length) throw new Error("Invalid desktop Super Properties: " + problems.join(", "));
    sp = desktop;
    kind = "desktop";
  }

  sp = fillLaunchFields({ ...sp });
  return { sp, b64: encodeSuperProperties(sp), kind };
}

export function buildHeaders(token, identity, timezone) {
  const sp = identity.sp;
  const locale = typeof sp.system_locale === "string" && sp.system_locale ? sp.system_locale : "en-US";
  return {
    Authorization: token,
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": locale,
    "User-Agent": sp.browser_user_agent || DEFAULT_UA,
    "X-Super-Properties": identity.b64,
    "X-Discord-Locale": locale,
    "X-Discord-Timezone": timezone || "UTC",
    "X-Installation-Id": sp["x-installation-id"],
    Origin: "https://discord.com",
    Referer: "https://discord.com/quest-home",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

export async function discordRequest(path, { headers, method = "GET", body, timeoutMs = 15000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    return { status: response.status, ok: response.ok, text, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchApplicationName(headers, applicationId) {
  const r = await discordRequest(`/applications/public?application_ids=${applicationId}`, { headers });
  if (!r.ok || !Array.isArray(r.json)) return null;
  const entry = r.json.find((a) => a && String(a.id) === String(applicationId));
  return entry && typeof entry.name === "string" && entry.name ? entry.name : null;
}

export async function fetchQuest(headers, questId) {
  const r = await discordRequest("/quests/@me", { headers });
  if (!r.ok || !r.json) return null;
  const list = Array.isArray(r.json) ? r.json : r.json.quests;
  if (!Array.isArray(list)) return null;
  return list.find((q) => q && String(q.id) === String(questId)) || null;
}

export function readProgress(payload, taskTypes) {
  if (!payload || typeof payload !== "object") return { value: null, completed: false };
  const status = payload.user_status || payload.userStatus || payload;
  const progress = status.progress && typeof status.progress === "object" ? status.progress : null;
  let value = null;
  if (progress) {
    for (const task of taskTypes) {
      const entry = progress[task];
      if (entry && typeof entry.value === "number") {
        value = entry.value;
        break;
      }
    }
  }
  const completed = Boolean(
    status.completed_at || status.completedAt || status.claimed_at || status.claimedAt,
  );
  return { value, completed };
}

export function readTarget(quest, taskTypes) {
  if (!quest || typeof quest !== "object") return 0;
  const cfg = quest.config || {};
  const tc = cfg.taskConfig || cfg.task_config || cfg.task_config_v2 || cfg.taskConfigV2;
  const tasks = tc && typeof tc === "object" ? tc.tasks || tc : null;
  if (!tasks) return 0;
  for (const task of taskTypes) {
    const entry = tasks[task];
    if (entry && typeof entry.target === "number") return entry.target;
  }
  return 0;
}

export function heartbeatVariants(applicationId, taskType) {
  if (STREAM_TASKS.includes(taskType)) {
    return [
      {
        id: "stream+app",
        body: () => ({ stream_key: "call:0:1", application_id: String(applicationId), terminal: false }),
      },
    ];
  }
  return [
    { id: "app", body: () => ({ application_id: String(applicationId), terminal: false }) },
    {
      id: "app+call",
      body: () => ({ stream_key: "call:0:1", application_id: String(applicationId), terminal: false }),
    },
  ];
}

export function buildActivity(name, applicationId, startedAt) {
  return {
    name,
    type: 0,
    application_id: String(applicationId),
    created_at: startedAt,
    timestamps: { start: startedAt },
  };
}

export class GatewayClient {
  constructor({ token, identity, activity, timezone }) {
    this.token = token;
    this.identity = identity;
    this.activity = activity;
    this.timezone = timezone;
    this.ws = null;
    this.state = "idle";
    this.seq = null;
    this.sessionId = null;
    this.closeCode = null;
    this.heartbeatDelay = null;
    this.heartbeatTimer = null;
    this.acked = true;
  }

  presence() {
    return { status: "online", since: 0, activities: [this.activity], afk: false };
  }

  identifyPayload() {
    const d = {
      token: this.token,
      properties: this.identity.sp,
      presence: this.presence(),
      compress: false,
      client_state: { guild_versions: {} },
    };
    const caps = Number(process.env.GATEWAY_CAPABILITIES);
    if (process.env.GATEWAY_CAPABILITIES && Number.isFinite(caps)) d.capabilities = caps;
    return { op: 2, d };
  }

  send(packet) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(packet));
  }

  stopHeartbeat() {
    if (this.heartbeatDelay) clearTimeout(this.heartbeatDelay);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatDelay = null;
    this.heartbeatTimer = null;
  }

  beat() {
    if (!this.acked) {
      this.state = "zombie";
      try {
        this.ws.close(4000);
      } catch (e) {}
      return;
    }
    this.acked = false;
    this.send({ op: 1, d: this.seq });
  }

  startHeartbeat(interval) {
    this.stopHeartbeat();
    this.acked = true;
    this.heartbeatDelay = setTimeout(() => {
      this.beat();
      this.heartbeatTimer = setInterval(() => this.beat(), interval);
    }, Math.floor(interval * Math.random()));
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.close();
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new Error("gateway READY timeout")), timeoutMs);

      let ws;
      try {
        const wsHeaders = { Origin: "https://discord.com" };
        if (this.identity.sp.browser_user_agent) wsHeaders["User-Agent"] = this.identity.sp.browser_user_agent;
        ws = new WebSocket(gatewayUrl(), { headers: wsHeaders });
      } catch (e) {
        finish(e);
        return;
      }

      this.ws = ws;
      this.state = "connecting";
      this.seq = null;

      ws.onerror = () => finish(new Error("gateway socket error"));
      ws.onclose = (event) => {
        this.closeCode = event.code;
        this.stopHeartbeat();
        if (this.state !== "closing") this.state = "closed";
        finish(new Error(`gateway closed with code ${event.code}`));
      };
      ws.onmessage = (event) => {
        let packet;
        try {
          const raw = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
          packet = JSON.parse(raw);
        } catch (e) {
          return;
        }
        if (typeof packet.s === "number") this.seq = packet.s;

        if (packet.op === 10) {
          this.startHeartbeat(Number(packet.d && packet.d.heartbeat_interval) || 41250);
          this.send(this.identifyPayload());
        } else if (packet.op === 11) {
          this.acked = true;
        } else if (packet.op === 1) {
          this.send({ op: 1, d: this.seq });
        } else if (packet.op === 0 && packet.t === "READY") {
          this.sessionId = packet.d && packet.d.session_id ? packet.d.session_id : null;
          this.state = "ready";
          this.send({ op: 3, d: this.presence() });
          finish(null);
        } else if (packet.op === 7 || packet.op === 9) {
          this.state = "closed";
          finish(new Error(packet.op === 7 ? "gateway requested reconnect" : "gateway invalid session"));
          try {
            ws.close(4000);
          } catch (e) {}
        }
      };
    });
  }

  close() {
    this.state = "closing";
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close(1000);
      } catch (e) {}
    }
    this.ws = null;
    this.state = "closed";
  }
}