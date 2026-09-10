"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectUsage, normalizePercent, rateBlock } = require("../windows/collector");

test("normalizes fraction and percentage rate-limit formats", () => {
  assert.equal(normalizePercent(0.42), 42);
  assert.equal(normalizePercent(42), 42);
  assert.equal(normalizePercent(200), 100);
});

test("normalizes reset timestamps", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  assert.deepEqual(rateBlock({ used_percent: 25, window_minutes: 300, resets_at: 1789045200 }, now), {
    percentUsed: 25,
    windowMinutes: 300,
    resetsAt: "2026-09-10T13:00:00.000Z",
    resetsInMinutes: 60,
  });
});

test("collects current and legacy token-count records", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionDir = path.join(root, "sessions", "2026", "09", "10");
  fs.mkdirSync(sessionDir, { recursive: true });
  const records = [
    { timestamp: "2026-09-10T10:00:00Z", type: "session_meta", payload: { id: "session-one" } },
    { timestamp: "2026-09-10T10:00:30Z", type: "turn_context", payload: { model: "gpt-5.4" } },
    { timestamp: "2026-09-10T10:00:40Z", type: "event_msg", payload: { type: "user_message" } },
    {
      timestamp: "2026-09-10T10:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { total_tokens: 1200, input_tokens: 1000, cached_input_tokens: 600, output_tokens: 200 },
          total_token_usage: { total_tokens: 4200 },
        },
        rate_limits: {
          primary: { used_percent: 0.25, window_minutes: 300, resets_at: 1789052400 },
          secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1789646400 },
        },
      },
    },
    {
      timestamp: "2026-09-10T10:02:00Z",
      type: "event_msg",
      payload: {
        item: {
          type: "token_count",
          info: { last_token_usage: { total_tokens: 300, input_tokens: 200, cached_input_tokens: 100, output_tokens: 100 } },
          rate_limits: {},
        },
      },
    },
    { timestamp: "2026-09-10T10:03:00Z", type: "event_msg", payload: { type: "task_started" } },
    { timestamp: "2026-09-10T10:03:30Z", type: "event_msg", payload: { type: "turn_aborted" } },
    { timestamp: "2026-09-10T10:04:00Z", type: "event_msg", payload: { type: "task_complete" } },
  ];
  const sessionFile = path.join(sessionDir, "rollout.jsonl");
  fs.writeFileSync(sessionFile, records.map(JSON.stringify).join("\n"));
  fs.utimesSync(sessionFile, new Date("2026-09-10T10:02:00Z"), new Date("2026-09-10T10:02:00Z"));

  const result = collectUsage({ codexHome: root, now: new Date("2026-09-10T12:00:00Z"), locale: "pt-BR" });
  assert.equal(result.available, true);
  assert.equal(result.activity.last7DaysTokens, 1500);
  assert.equal(result.activity.last7DaysTurns, 1);
  assert.equal(result.activity.last7DaysSessions, 1);
  assert.equal(result.rateLimits.session.percentUsed, 25);
  assert.equal(result.activity.currentThreadTokens, 4200);
  assert.equal(result.activity.today.outputTokens, 300);
  assert.equal(result.activity.today.cacheHitRate, 58);
  assert.equal(result.activity.recent2Hours.outputTokensPerHour, 150);
  assert.equal(result.activity.recent2Hours.errors, 1);
  assert.equal(result.activity.recent2Hours.averageTaskMs, 60000);
  assert.equal(result.activity.currentModel, "gpt-5.4");
});
