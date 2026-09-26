import { accountHeaders } from "./account-context.js";
import { state } from "./state.js";
import { pauseAutomation } from "./automation.js";
import { message } from "./setup.js";
import { refresh } from "./ui.js";

export async function api(path, body, isForm = false) {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...accountHeaders(), ...(isForm ? {} : { "Content-Type": "application/json" }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("Server returned " + response.status + ". Check the backend terminal.");
  }
  if (!response.ok) {
    let detail = data.detail;
    throw Error(typeof detail === "string" ? detail : JSON.stringify(detail || data));
  }
  return data;
}

export async function run(task) {
  if (state.busy) return;
  state.busy = true;
  refresh();
  try {
    await task();
  } catch (err) {
    if (state.current && (!state.interviewSession || state.interviewSession.loaded))
      state.answerSubmitted = false;
    pauseAutomation("Automatic flow paused: " + (err.message || "The request failed."));
    message(err.message || "The request failed.", true);
  } finally {
    state.busy = false;
    refresh();
  }
}
