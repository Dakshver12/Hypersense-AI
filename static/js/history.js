import { $ } from "./dom.js";
import { modeName } from "./setup.js";
import { refresh } from "./ui.js";
import { sessionStore, openSavedSession, deleteSavedSession } from "./storage.js";

export async function renderSavedSessions() {
  const list = $("saved-session-list");
  try {
    const sessions = await sessionStore("readonly", (store) => store.getAll());
    sessions.sort((a, b) => b.date.localeCompare(a.date));
    list.replaceChildren();
    if (!sessions.length) {
      list.textContent = "No completed sessions saved yet.";
      return;
    }
    for (const session of sessions) {
      const row = document.createElement("div");
      row.className = "actions";
      const label = document.createElement("span");
      label.textContent =
        new Date(session.date).toLocaleString() +
        " · " +
        session.settings.technology +
        " · " +
        modeName(session.settings.interview_type) +
        " · " +
        session.answers.length +
        "/" +
        session.total +
        " answers";
      row.appendChild(label);
      for (const [title, action] of [
        ["Open report", () => openSavedSession(session.id)],
        ["Delete session", () => deleteSavedSession(session.id)],
      ]) {
        const button = document.createElement("button");
        button.textContent = title;
        button.dataset.sessionHistory = "true";
        button.onclick = action;
        row.appendChild(button);
      }
      list.appendChild(row);
    }
    refresh();
  } catch {
    list.textContent = "Saved sessions unavailable. Browser storage may be blocked.";
  }
}
