import { state } from "./state.js";
import { $ } from "./dom.js";
import { cancelQuestionSpeech } from "./speech.js";
import { message, modeName } from "./setup.js";
import { refresh } from "./ui.js";
import { stopCamera } from "./camera.js";
import { sessionStore, openSavedSession, deleteSavedSession } from "./storage.js";
import { setPageView, showSetupPage } from "./navigation.js";

export function dashboardSummary(sessions, filter = "all") {
  const rows = sessions
    .map((session) => ({
      ...session,
      selected: (session.answers || []).filter(
        (a) => filter === "all" || (a.interview_type || "technical") === filter,
      ),
    }))
    .filter((s) => filter === "all" || s.selected.length);
  const answers = rows.flatMap((s) => s.selected);
  const valid = (a) =>
    typeof a.score === "number" && Number.isFinite(a.score) && a.score >= 0 && a.score <= 100;
  const groups = ["technical", "behavioral", "hr"].map((type) => {
    const scored = answers.filter((a) => (a.interview_type || "technical") === type && valid(a));
    return {
      type,
      count: scored.length,
      average: scored.length ? scored.reduce((n, a) => n + a.score, 0) / scored.length : null,
    };
  });
  return {
    rows,
    groups,
    answers: answers.length,
    scored: answers.filter(valid).length,
    pending: answers.filter((a) => !valid(a)).length,
  };
}

export function deliveryAverages(answers) {
  const pace = answers
    .map((a) => a.audio?.words_per_minute)
    .filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  const confidence = answers
    .map((a) => Number(a.confidence))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 5);
  const mean = (values) =>
    values.length ? values.reduce((n, v) => n + v, 0) / values.length : null;
  return {
    pace: mean(pace),
    paceCount: pace.length,
    confidence: mean(confidence),
    confidenceCount: confidence.length,
  };
}

export async function renderDashboard() {
  const load = ++state.dashboardLoad;
  const status = $("dashboard-status");
  status.textContent = "Loading saved sessions…";
  for (const id of [
    "dashboard-stats",
    "dashboard-types",
    "dashboard-progress",
    "dashboard-sessions",
    "dashboard-delivery",
  ])
    $(id).replaceChildren();
  try {
    const sessions = await sessionStore("readonly", (store) => store.getAll());
    if (load !== state.dashboardLoad) return;
    sessions.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const topic = $("dashboard-topic").value;
    $("dashboard-topic").replaceChildren();
    for (const name of [
      "",
      ...new Set(sessions.map((s) => s.settings?.technology || "General")),
    ].sort()) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name || "All topics";
      $("dashboard-topic").appendChild(option);
    }
    $("dashboard-topic").value = [...$("dashboard-topic").options].some((o) => o.value === topic)
      ? topic
      : "";
    const filtered = sessions.filter(
      (s) =>
        !$("dashboard-topic").value ||
        (s.settings?.technology || "General") === $("dashboard-topic").value,
    );
    const summary = dashboardSummary(filtered, $("dashboard-filter").value);
    const add = (parent, tag, text) => {
      const node = document.createElement(tag);
      node.textContent = text;
      parent.appendChild(node);
      return node;
    };
    status.textContent = summary.rows.length
      ? "Updated from saved sessions."
      : sessions.length
        ? "No sessions match this filter."
        : "Your dashboard will fill up after your first saved interview.";
    for (const [label, value] of [
      ["Saved sessions", summary.rows.length],
      ["Answers practised", summary.answers],
      ["Answers scored", summary.scored],
      ["Pending scores", summary.pending],
    ]) {
      const card = add($("dashboard-stats"), "div", "");
      card.className = "dashboard-stat";
      add(card, "span", label);
      add(card, "strong", String(value));
    }
    for (const group of summary.groups) {
      if ($("dashboard-filter").value !== "all" && $("dashboard-filter").value !== group.type)
        continue;
      const card = add($("dashboard-types"), "div", "");
      card.className = "dashboard-stat";
      add(card, "span", modeName(group.type));
      add(card, "strong", group.average === null ? "—" : group.average.toFixed(1) + "/100");
      add(card, "p", group.count + " scored answers");
      if (group.average !== null) {
        const bar = add(card, "meter", "");
        bar.min = 0;
        bar.max = 100;
        bar.value = group.average;
        bar.className = "dashboard-bar";
        bar.setAttribute("aria-label", modeName(group.type) + " average score");
      }
    }
    const table = (parent, headers) => {
      const t = add(parent, "table", "");
      t.className = "dashboard-table";
      const head = add(t, "thead", "");
      const row = add(head, "tr", "");
      for (const h of headers) {
        const th = add(row, "th", h);
        th.scope = "col";
      }
      return add(t, "tbody", "");
    };
    const progress = table($("dashboard-progress"), [
      "Date",
      "Topic / difficulty",
      "Technical",
      "Behavioral",
      "HR",
    ]);
    for (const session of summary.rows.slice(0, 10).reverse()) {
      const row = add(progress, "tr", "");
      add(row, "td", new Date(session.date).toLocaleDateString());
      add(
        row,
        "td",
        (session.settings?.technology || "General") + " / " + (session.settings?.difficulty || "—"),
      );
      for (const group of dashboardSummary([session], $("dashboard-filter").value).groups)
        add(row, "td", group.average === null ? "—" : group.average.toFixed(1));
    }
    const delivery = table($("dashboard-delivery"), [
      "Date",
      "Pace (words/min)",
      "Self-rated confidence",
      "Samples (pace / rating)",
    ]);
    for (const session of summary.rows.slice(0, 10).reverse()) {
      const values = deliveryAverages(session.selected),
        row = add(delivery, "tr", "");
      add(row, "td", new Date(session.date).toLocaleDateString());
      add(row, "td", values.pace === null ? "Unavailable" : values.pace.toFixed(1));
      add(
        row,
        "td",
        values.confidence === null ? "Not rated" : values.confidence.toFixed(1) + "/5",
      );
      add(row, "td", values.paceCount + " / " + values.confidenceCount);
    }
    const history = table($("dashboard-sessions"), ["Session", "Type", "Answers", "Review"]);
    for (const session of summary.rows) {
      const row = add(history, "tr", "");
      add(
        row,
        "td",
        new Date(session.date).toLocaleString() +
          " · " +
          (session.settings?.technology || "General"),
      );
      add(row, "td", modeName(session.settings?.interview_type || "technical"));
      add(row, "td", session.answers.length + "/" + session.total);
      const cell = add(row, "td", "");
      const button = add(cell, "button", "Open report");
      button.onclick = () => {
        if (!state.busy && !state.recording && !state.interviewSession?.active)
          openSavedSession(session.id);
      };
      button.dataset.sessionHistory = "true";
      const remove = add(cell, "button", "Delete");
      remove.dataset.sessionHistory = "true";
      remove.onclick = () => deleteSavedSession(session.id);
    }
    refresh();
  } catch {
    if (load === state.dashboardLoad)
      status.textContent =
        "Could not load saved sessions. Browser storage may be unavailable. Reopen the dashboard to retry.";
  }
}

export function showDashboard() {
  if (state.busy || state.recording || state.interviewSession?.active) {
    message("Finish your current interview before opening the dashboard.");
    return;
  }
  cancelQuestionSpeech(false);
  stopCamera("Camera is off.");
  $("session-report")
    .querySelectorAll("audio")
    .forEach((player) => player.pause());
  setPageView(false);
  $("interview-page").hidden = true;
  $("interview-intro").hidden = true;
  $("dashboard-page").hidden = false;
  if (location.pathname + location.search !== "/interview?view=dashboard")
    history.pushState({}, "", "/interview?view=dashboard");
  document.title = "HyperSense AI · Dashboard";
  message("Your saved interview progress.");
  renderDashboard();
  $("dashboard-title").focus();
  window.scrollTo({ top: 0 });
}
export function initDashboard() {
  $("nav-dashboard").onclick = showDashboard;
  $("nav-practice").onclick = () => {
    if (!state.busy && !state.recording) showSetupPage();
  };
  $("dashboard-start").onclick = showSetupPage;
  $("dashboard-filter").onchange = renderDashboard;
  $("dashboard-topic").onchange = renderDashboard;
}
