import {
  GatewayClient,
  PLAY_TASKS,
  STREAM_TASKS,
  buildActivity,
  buildHeaders,
  decodeSuperProperties,
  discordRequest,
  fetchApplicationName,
  fetchQuest,
  heartbeatVariants,
  isSnowflake,
  readProgress,
  readTarget,
  resolveIdentity,
} from "../lib/discord.js";

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function sleepSlices(ms, shouldStop) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop()) return;
    await new Promise((r) => setTimeout(r, Math.min(250, Math.max(1, end - Date.now()))));
  }
}

const SP_BROWSER_ERROR =
  "Super Properties were captured from a web browser. This tool requires " +
  "Super Properties from the Discord desktop app (browser must be 'Discord Client').";

function parseInput(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return { error: "Body is not valid JSON" };
    }
  }
  data = data && typeof data === "object" ? data : {};

  const token = typeof data.token === "string" ? data.token.trim() : "";
  const superProperties = typeof data.super_properties === "string" ? data.super_properties.trim() : "";
  const desktopSuperProperties =
    typeof data.desktop_super_properties === "string" ? data.desktop_super_properties.trim() : "";

  if (!token || !superProperties || !data.quest_id) {
    return { error: "Missing token, super_properties or quest_id" };
  }
  if (/[\r\n]/.test(token)) return { error: "Invalid token" };
  if (!isSnowflake(data.quest_id)) return { error: "Invalid quest_id" };
  if (!isSnowflake(data.application_id)) return { error: "Invalid application_id" };

  const spDecoded = decodeSuperProperties(superProperties);
  if (!spDecoded) return { error: "Invalid Super Properties" };
  if (spDecoded.browser !== "Discord Client") return { error: SP_BROWSER_ERROR };

  const taskType = typeof data.task_type === "string" ? data.task_type : "PLAY_ON_DESKTOP";
  const known = [...PLAY_TASKS, ...STREAM_TASKS];
  if (!known.includes(taskType)) return { error: `Unsupported task_type ${taskType}` };

  const maxBudget = envNumber("SOLVE_MAX_SECONDS", 270);
  const requested = Number(data.budget_seconds);
  const startedAt = Number(data.play_started_at);
  const now = Date.now();

  return {
    token,
    superProperties,
    desktopSuperProperties,
    questId: String(data.quest_id),
    applicationId: String(data.application_id),
    applicationName:
      typeof data.application_name === "string" && data.application_name.trim()
        ? data.application_name.trim().slice(0, 128)
        : "",
    taskType,
    secondsNeeded: Math.max(0, Number(data.seconds_needed) || 0),
    secondsDone: Math.max(0, Number(data.seconds_done) || 0),
    timezone: typeof data.timezone === "string" && /^[A-Za-z0-9_\/+-]{1,64}$/.test(data.timezone) ? data.timezone : "UTC",
    budgetSeconds: clamp(Number.isFinite(requested) && requested > 0 ? requested : maxBudget, 5, maxBudget),
    playStartedAt: Number.isFinite(startedAt) && startedAt > 0 && startedAt <= now ? startedAt : now,
  };
}

async function runChunk(input, shouldStop) {
  const interval = clamp(envNumber("SOLVE_HEARTBEAT_INTERVAL_MS", 20000), 100, 120000);
  const settleMs = envNumber("SOLVE_GATEWAY_SETTLE_MS", 2000);
  const deadline = Date.now() + input.budgetSeconds * 1000;
  const taskTypes = STREAM_TASKS.includes(input.taskType) ? STREAM_TASKS : PLAY_TASKS;
  const usesGateway = taskTypes === PLAY_TASKS;

  const identity = resolveIdentity(input.superProperties, input.desktopSuperProperties);
  const headers = buildHeaders(input.token, identity, input.timezone);

  const diagnostic = {
    identity: identity.kind,
    gateway: usesGateway ? { state: "pending" } : { state: "not_used" },
    variant: null,
    attempts: [],
    application: { id: input.applicationId, name: input.applicationName || null },
    budget_seconds: input.budgetSeconds,
  };

  let done = input.secondsDone;
  let target = input.secondsNeeded;
  let iterations = 0;
  let lastError = null;
  let failures = 0;
  let stalled = 0;
  let variantIndex = 0;
  const variants = heartbeatVariants(input.applicationId, input.taskType);

  let lastGlobalRequest = 0;
  const MIN_REQUEST_GAP_MS = 2500;

  const waitGlobalGap = async () => {
    const now = Date.now();
    if (now - lastGlobalRequest < MIN_REQUEST_GAP_MS) {
      await sleepSlices(MIN_REQUEST_GAP_MS - (now - lastGlobalRequest) + Math.random() * 1000, shouldStop);
    }
    lastGlobalRequest = Date.now();
  };

  const finish = (status, extra) => ({
    ok: status !== "failed",
    status,
    current: done,
    target,
    iterations,
    last_error: lastError,
    diagnostic,
    ...extra,
  });

  let gateway = null;
  try {
    if (usesGateway) {
      if (!diagnostic.application.name) {
        try {
          await waitGlobalGap();
          diagnostic.application.name = await fetchApplicationName(headers, input.applicationId);
        } catch (e) {
          diagnostic.application.name = null;
        }
      }
      const activityName = diagnostic.application.name || `Application ${input.applicationId}`;
      gateway = new GatewayClient({
        token: input.token,
        identity,
        activity: buildActivity(activityName, input.applicationId, input.playStartedAt),
        timezone: input.timezone,
      });
      try {
        await gateway.connect(15000);
        diagnostic.gateway = { state: "ready", session: Boolean(gateway.sessionId) };
        await sleepSlices(settleMs, shouldStop);
      } catch (e) {
        diagnostic.gateway = { state: "failed", error: e.message, close_code: gateway.closeCode };
        gateway.close();
      }
    }

    while (!shouldStop() && Date.now() < deadline) {
      iterations++;

      if (gateway && diagnostic.gateway.state !== "failed" && gateway.state !== "ready") {
        try {
          await gateway.connect(10000);
          diagnostic.gateway = { state: "ready", session: Boolean(gateway.sessionId), reconnected: true };
        } catch (e) {
          diagnostic.gateway = { state: "failed", error: e.message, close_code: gateway.closeCode };
          gateway.close();
        }
      }

      let hb = null;
      let rejected = false;
      for (let i = variantIndex; i < variants.length; i++) {
        await waitGlobalGap();
        let attempt;
        try {
          attempt = await discordRequest(`/quests/${input.questId}/heartbeat`, {
            headers,
            method: "POST",
            body: variants[i].body(),
          });
        } catch (e) {
          lastError = `heartbeat request failed: ${e.message}`;
          attempt = null;
          break;
        }
        if (attempt.status === 401 || attempt.status === 403) {
          if (diagnostic.attempts.length < 8) {
            diagnostic.attempts.push({
              variant: variants[i].id,
              status: attempt.status,
              body: attempt.text.slice(0, 200),
            });
          }
          if (i === variants.length - 1) rejected = true;
          continue;
        }
        hb = attempt;
        variantIndex = i;
        diagnostic.variant = variants[i].id;
        break;
      }

      if (rejected) {
        lastError = diagnostic.attempts.length ? diagnostic.attempts[diagnostic.attempts.length - 1].body : null;
        return finish("auth_rejected", {
          ok: false,
          error: lastError,
          note:
            "Discord rejected every heartbeat variant with 401/403. See diagnostic.identity, " +
            "diagnostic.gateway and diagnostic.attempts.",
        });
      }

      if (!hb) {
        failures++;
        if (failures >= 6) return finish("failed", { ok: false, error: lastError || "heartbeat failed repeatedly" });
        await sleepSlices(3000 * Math.pow(2, failures - 1) + Math.random() * 1000, shouldStop);
        continue;
      }

      if (hb.status === 429) {
        const baseWait = (hb.json && typeof hb.json.retry_after === "number" ? hb.json.retry_after : 15);
        const safeWait = (baseWait + 1 + Math.random() * 2) * 1000;
        await sleepSlices(safeWait, shouldStop);
        failures++;
        if (failures >= 5) return finish("failed", { ok: false, error: "Rate limited persistently" });
        continue;
      }

      if (!hb.ok) {
        failures++;
        lastError = `HTTP ${hb.status}: ${hb.text.slice(0, 200)}`;
        const backoff = Math.min(3000 * Math.pow(2, failures - 1), 30000);
        await sleepSlices(backoff + Math.random() * 1000, shouldStop);
        if (failures >= 6) return finish("failed", { ok: false, error: lastError });
        continue;
      }

      failures = 0;
      let progress = readProgress(hb.json, taskTypes);

      if (progress.value === null && !progress.completed) {
        try {
          await waitGlobalGap();
          const quest = await fetchQuest(headers, input.questId);
          if (quest) {
            progress = readProgress(quest, taskTypes);
            const questTarget = readTarget(quest, taskTypes);
            if (questTarget) target = questTarget;
          }
        } catch (e) {
          lastError = `progress refresh failed: ${e.message}`;
        }
      }

      if (progress.value !== null) {
        if (progress.value > done) {
          done = progress.value;
          stalled = 0;
        } else {
          stalled++;
        }
      }

      if (progress.completed || (target > 0 && done >= target)) {
        if (target > 0 && done < target) done = target;
        return finish("completed");
      }

      if (stalled >= 5) {
        return finish("no_progress", {
          note: "Discord accepted 5 heartbeats without any progress.",
        });
      }

      if (deadline - Date.now() <= interval) break;
      await sleepSlices(interval, shouldStop);
    }

    return finish(target > 0 && done >= target ? "completed" : "in_progress");
  } finally {
    if (gateway) gateway.close();
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const input = parseInput(req.body);
  if (input.error) return res.status(400).json({ ok: false, error: input.error });

  let aborted = false;
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  try {
    const result = await runChunk(input, () => aborted);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({
      ok: false,
      status: "failed",
      error: e && e.message ? e.message : "solver error",
      current: input.secondsDone,
      target: input.secondsNeeded,
    });
  }
}