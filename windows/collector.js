"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function tokenTotal(usage) {
  const value = Number(usage?.total_tokens ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function usageMetrics(usage) {
  const safe = usage && typeof usage === "object" ? usage : {};
  const number = (key) => {
    const value = Number(safe[key] ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  };
  return {
    tokens: number("total_tokens"),
    inputTokens: number("input_tokens"),
    cachedInputTokens: number("cached_input_tokens"),
    outputTokens: number("output_tokens"),
    reasoningOutputTokens: number("reasoning_output_tokens"),
  };
}

function addMetrics(target, metrics) {
  for (const key of ["tokens", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"]) {
    target[key] = (target[key] || 0) + (metrics[key] || 0);
  }
}

function normalizePercent(value) {
  let used = Number(value ?? 0);
  if (!Number.isFinite(used)) used = 0;
  // Codex session records have historically used both fractions and percentages.
  if (used > 0 && used <= 1) used *= 100;
  return Math.max(0, Math.min(100, used));
}

function rateBlock(snapshot, now) {
  if (!snapshot || typeof snapshot !== "object") return null;

  const rawReset = snapshot.resets_at ?? snapshot.resetsAt ?? snapshot.reset_at;
  let reset = null;
  if (typeof rawReset === "number" && Number.isFinite(rawReset)) {
    reset = new Date(rawReset * 1000);
  } else if (typeof rawReset === "string") {
    reset = parseTime(rawReset);
  }

  const windowMinutes = Number(
    snapshot.window_minutes ??
      snapshot.windowMinutes ??
      (Number(snapshot.limit_window_seconds ?? 0) / 60),
  );

  return {
    percentUsed: normalizePercent(snapshot.used_percent ?? snapshot.usedPercent),
    windowMinutes: Number.isFinite(windowMinutes) ? Math.trunc(windowMinutes) : 0,
    resetsAt: reset ? reset.toISOString() : "",
    resetsInMinutes: reset
      ? Math.max(0, Math.floor((reset.getTime() - now.getTime()) / 60000))
      : 0,
  };
}

function localDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(date, locale = "pt-BR") {
  return new Intl.DateTimeFormat(locale, { weekday: "short" })
    .format(date)
    .replace(".", "")
    .slice(0, 3);
}

function listJsonlFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];

  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  return files;
}

function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

function collectUsage(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsDir = path.join(codexHome, "sessions");
  const cutoffMs = now.getTime() - 7 * DAY_MS;
  const recentCutoffMs = now.getTime() - 2 * 60 * 60 * 1000;
  const daily = new Map();
  const sessions = new Set();
  const modelTokens = new Map();
  const totals = {};
  const recent = { errors: 0, taskDurationsMs: [] };
  let latest = null;
  let latestInfo = null;
  let latestLimits = null;
  let latestThreadUsage = null;
  let latestModel = null;
  let turns = 0;

  for (const file of listJsonlFiles(sessionsDir)) {
    try {
      if (fs.statSync(file).mtimeMs < cutoffMs) continue;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      let currentModel = "Codex";
      let taskStartedAt = null;
      for (const line of lines) {
        if (!line.trim()) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }

        const timestamp = parseTime(record.timestamp);
        if (!timestamp) continue;
        const payload = record.payload || {};
        const timestampMs = timestamp.getTime();

        if (typeof payload.model === "string" && payload.model) {
          currentModel = payload.model;
          if (!latestModel || timestampMs > latestModel.timestamp.getTime()) {
            latestModel = { timestamp, value: payload.model };
          }
        }

        if (record.type === "session_meta" && timestampMs >= cutoffMs) {
          const sessionId = payload.session_id ?? payload.id;
          if (sessionId) sessions.add(String(sessionId));
        }
        if (record.type !== "event_msg") continue;

        const eventType = payload.type || payload.item?.type || "";
        if (eventType === "task_started") taskStartedAt = timestampMs;
        if (eventType === "task_complete" && taskStartedAt !== null) {
          if (timestampMs >= recentCutoffMs) recent.taskDurationsMs.push(Math.max(0, timestampMs - taskStartedAt));
          taskStartedAt = null;
        }
        if (["error", "stream_error", "turn_aborted"].includes(eventType) && timestampMs >= recentCutoffMs) {
          recent.errors += 1;
        }
        if (eventType === "task_started" && timestampMs >= cutoffMs) {
          const key = localDayKey(timestamp);
          const bucket = daily.get(key) || {};
          bucket.turns = (bucket.turns || 0) + 1;
          daily.set(key, bucket);
          turns += 1;
        }

        const item = payload.type === "token_count" ? payload : (payload.item || {});
        if (item.type !== "token_count") continue;
        const info = item.info || {};
        const limits = item.rate_limits || {};

        if (!latest || timestampMs > latest.timestamp.getTime()) {
          latest = { timestamp, info, limits };
        }
        if (Object.keys(info).length && (!latestInfo || timestampMs > latestInfo.timestamp.getTime())) {
          latestInfo = { timestamp, value: info };
        }
        if (info.total_token_usage && (!latestThreadUsage || timestampMs > latestThreadUsage.timestamp.getTime())) {
          latestThreadUsage = { timestamp, value: info.total_token_usage };
        }
        if (Object.keys(limits).length && (!latestLimits || timestampMs > latestLimits.timestamp.getTime())) {
          latestLimits = { timestamp, value: limits };
        }

        if (timestampMs >= cutoffMs) {
          const metrics = usageMetrics(info.last_token_usage);
          const key = localDayKey(timestamp);
          const bucket = daily.get(key) || {};
          addMetrics(bucket, metrics);
          daily.set(key, bucket);
          addMetrics(totals, metrics);
          modelTokens.set(currentModel, (modelTokens.get(currentModel) || 0) + metrics.tokens);
          if (timestampMs >= recentCutoffMs) addMetrics(recent, metrics);
        }
      }
    } catch {
      // A session can still be in use. Skip it and keep the last good snapshot.
    }
  }

  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const bucket = daily.get(localDayKey(date)) || {};
    days.push({
      label: dayLabel(date, options.locale),
      tokens: bucket.tokens || 0,
      turns: bucket.turns || 0,
      inputTokens: bucket.inputTokens || 0,
      cachedInputTokens: bucket.cachedInputTokens || 0,
      outputTokens: bucket.outputTokens || 0,
    });
  }

  const limits = latestLimits?.value || latest?.limits || {};
  const info = latestInfo?.value || latest?.info || {};
  const session = rateBlock(limits.primary, now) || {};
  const weekly = rateBlock(limits.secondary, now) || {};
  const today = daily.get(localDayKey(now)) || {};
  const cacheHitRate = today.inputTokens
    ? Math.round((today.cachedInputTokens || 0) / today.inputTokens * 100)
    : 0;
  const averageTaskMs = recent.taskDurationsMs.length
    ? Math.round(recent.taskDurationsMs.reduce((sum, value) => sum + value, 0) / recent.taskDurationsMs.length)
    : 0;
  const models = [...modelTokens.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, value]) => ({
      name,
      tokens: value,
      percent: totals.tokens ? Math.round(value / totals.tokens * 100) : 0,
    }));
  const result = {
    generatedAt: now.toISOString(),
    source: "Logs locais do Codex",
    available: Boolean(latest),
    rateLimits: {
      session,
      weekly,
      weeklyAll: weekly,
      plan: limits.plan_type || "",
      source: "local_log",
    },
    activity: {
      last7DaysTokens: totals.tokens || 0,
      last7DaysTurns: turns,
      last7DaysSessions: sessions.size,
      daily: days,
      currentThreadTokens: tokenTotal(latestThreadUsage?.value || info.total_token_usage),
      recent2Hours: {
        outputTokensPerHour: Math.round((recent.outputTokens || 0) / 2),
        errors: recent.errors,
        averageTaskMs,
      },
      today: {
        tokens: today.tokens || 0,
        inputTokens: today.inputTokens || 0,
        outputTokens: today.outputTokens || 0,
        cachedInputTokens: today.cachedInputTokens || 0,
        messages: today.turns || 0,
        cacheHitRate,
      },
      currentModel: latestModel?.value || models[0]?.name || "Codex",
      models,
    },
  };

  if (options.outputFile) atomicWriteJson(options.outputFile, result);
  return result;
}

module.exports = {
  DAY_MS,
  atomicWriteJson,
  collectUsage,
  normalizePercent,
  rateBlock,
  usageMetrics,
};
