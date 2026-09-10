"use strict";

const $ = (selector) => document.querySelector(selector);
let currentData = null;

function formatNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${Math.round(number / 1_000)}K`;
  return String(Math.round(number));
}

function compactModel(value) {
  return String(value || "Codex").replace(/^gpt-/i, "").replace(/-codex$/i, "");
}

function durationText(milliseconds) {
  const seconds = Math.round(Number(milliseconds || 0) / 1000);
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}`;
}

function remainingParts(windowData) {
  const target = new Date(windowData?.resetsAt || "");
  if (Number.isNaN(target.getTime())) return null;
  const seconds = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
  return {
    seconds,
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    rest: seconds % 60,
    target,
  };
}

function countdownText(windowData) {
  const remaining = remainingParts(windowData);
  if (!remaining) return "--:--:--";
  const totalHours = Math.floor(remaining.seconds / 3600);
  return `${String(totalHours).padStart(2, "0")}:${String(remaining.minutes).padStart(2, "0")}:${String(remaining.rest).padStart(2, "0")}`;
}

function resetText(windowData) {
  const remaining = remainingParts(windowData);
  if (!remaining) return "Horário de reset indisponível";
  const relative = remaining.days
    ? `${remaining.days}d ${remaining.hours}h`
    : remaining.hours
      ? `${remaining.hours}h ${remaining.minutes}min`
      : `${remaining.minutes}min`;
  const clock = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(remaining.target);
  return `Reseta em ${relative} · ${clock}`;
}

function usageState(percent) {
  if (percent >= 80) return { label: "Crítico", className: "danger", color: "var(--danger)" };
  if (percent >= 50) return { label: "Atenção", className: "warning", color: "var(--warning)" };
  return { label: "Tranquilo", className: "", color: "var(--accent)" };
}

function renderLimit(prefix, value) {
  const percent = Math.max(0, Math.min(100, Number(value?.percentUsed || 0)));
  $(`#${prefix}-value`).textContent = `${Math.round(percent)}%`;
  const bar = $(`#${prefix}-bar`);
  bar.style.width = `${percent}%`;
  bar.classList.toggle("warning", percent >= 80);
}

function renderChart(days) {
  const chart = $("#chart");
  chart.replaceChildren();
  const safeDays = Array.isArray(days) ? days : [];
  const maximum = Math.max(1, ...safeDays.map((day) => Number(day.tokens || 0)));
  for (const day of safeDays) {
    const item = document.createElement("div");
    item.className = "chart-day";
    item.title = `${formatNumber(day.tokens)} tokens · ${day.turns || 0} mensagens`;
    const column = document.createElement("div");
    column.className = "chart-column";
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(4, (Number(day.tokens || 0) / maximum) * 100)}%`;
    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = day.label || "—";
    column.append(bar);
    item.append(column, label);
    chart.append(item);
  }
}

function renderModels(models) {
  const container = $("#models");
  const card = $("#models-card");
  container.replaceChildren();
  const visibleModels = Array.isArray(models) ? models.slice(0, 4) : [];
  card.hidden = visibleModels.length === 0;
  for (const model of visibleModels) {
    const row = document.createElement("div");
    row.className = "model-row";
    const heading = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = model.name;
    const value = document.createElement("strong");
    value.textContent = `${model.percent}% · ${formatNumber(model.tokens)}`;
    heading.append(name, value);
    const track = document.createElement("div");
    track.className = "track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${Math.max(2, model.percent)}%`;
    track.append(bar);
    row.append(heading, track);
    container.append(row);
  }
}

function serviceClass(status) {
  if (["major_outage", "critical", "major"].includes(status)) return "danger";
  if (["partial_outage", "degraded_performance", "minor", "maintenance"].includes(status)) return "warning";
  if (["unknown", "under_maintenance"].includes(status)) return "unknown";
  return "";
}

function renderService(status) {
  const summary = $("#service-summary");
  const components = $("#components");
  const stateClass = serviceClass(status?.indicator || "unknown");
  summary.className = `service-summary ${stateClass}`.trim();
  summary.replaceChildren();
  const dot = document.createElement("i");
  const text = document.createTextNode(` ${status?.description || "Status indisponível"}`);
  summary.append(dot, text);
  components.replaceChildren();

  const list = Array.isArray(status?.components) && status.components.length
    ? status.components
    : [{ name: "OpenAI Status", status: status?.available ? "operational" : "unknown" }];
  for (const component of list) {
    const badge = document.createElement("span");
    badge.className = `component ${serviceClass(component.status)}`.trim();
    const indicator = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = component.name;
    badge.append(indicator, label);
    components.append(badge);
  }
}

function updateCountdown() {
  if (!currentData?.available) return;
  const session = currentData.rateLimits?.session || {};
  $("#session-countdown").textContent = countdownText(session);
}

function render(data) {
  currentData = data;
  const available = data?.available === true;
  $("#empty").hidden = available;
  $("#content").hidden = !available;
  if (!available) {
    $("#usage-state").textContent = "Sem dados";
    return;
  }

  const limits = data.rateLimits || {};
  const session = limits.session || {};
  const weekly = limits.weeklyAll || limits.weekly || {};
  const activity = data.activity || {};
  const recent = activity.recent2Hours || {};
  const today = activity.today || {};
  const sessionPercent = Math.max(0, Math.min(100, Number(session.percentUsed || 0)));
  const state = usageState(sessionPercent);
  const pill = $("#usage-state");
  pill.textContent = state.label;
  pill.className = `state-pill ${state.className}`.trim();
  $("#session-ring").style.setProperty("--value", sessionPercent);
  $("#session-ring").style.setProperty("--ring-color", state.color);

  renderLimit("session", session);
  $("#session-inline-value").textContent = `${Math.round(sessionPercent)}%`;
  renderLimit("weekly", weekly);
  $("#session-reset").textContent = "até resetar a janela da sessão";
  $("#weekly-reset").textContent = resetText(weekly);
  $("#plan").textContent = String(limits.plan || "plano").toUpperCase();
  updateCountdown();

  const model = activity.currentModel || "Codex";
  $("#model-label").textContent = model;
  $("#model-short").textContent = compactModel(model);
  $("#output-rate").textContent = formatNumber(recent.outputTokensPerHour);
  $("#errors").textContent = formatNumber(recent.errors);
  $("#errors").className = recent.errors ? "bad" : "good";
  $("#duration").textContent = durationText(recent.averageTaskMs);
  $("#today-tokens").textContent = formatNumber(today.tokens);
  $("#today-output").textContent = formatNumber(today.outputTokens);
  $("#today-messages").textContent = formatNumber(today.messages);
  $("#cache-hit").textContent = `${today.cacheHitRate || 0}%`;
  $("#week-total").textContent = `${formatNumber(activity.last7DaysTokens)} tokens`;
  $("#updated").textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.generatedAt));
  renderModels(activity.models);
  renderService(data.serviceStatus);
  renderChart(activity.daily);
}

async function refresh() {
  const button = $("#refresh");
  button.disabled = true;
  button.classList.add("loading");
  try {
    render(await window.codexUsage.getUsage());
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

$("#close").addEventListener("click", () => window.codexUsage.hide());
$("#refresh").addEventListener("click", refresh);
$("#startup").addEventListener("change", async (event) => {
  event.target.checked = await window.codexUsage.setStartup(event.target.checked);
});
window.codexUsage.onUsage(render);
window.codexUsage.getStartup().then((enabled) => { $("#startup").checked = enabled; });
setInterval(updateCountdown, 1000);
refresh();
