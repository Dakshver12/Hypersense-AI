import { state } from "./state.js";
import { $ } from "./dom.js";
import { cancelAutomation, pauseAutomation } from "./automation.js";
import { cancelQuestionSpeech } from "./speech.js";
import { message } from "./setup.js";
import { refresh } from "./ui.js";
import { cameraMessage, stopCamera } from "./camera.js";
import { showDashboard } from "./dashboard.js";
import { openSavedSession } from "./storage.js";

export function showCameraCheck(offerPermission = true) {
  $("camera-title")
    .closest("section")
    .insertBefore($("camera-preview"), $("calibrate").parentElement);
  if (state.interviewSession?.active)
    pauseAutomation("Camera check open. Return to the interview to continue manually.");
  if (location.pathname !== "/camera-check") history.pushState({}, "", "/camera-check");
  $("interview-page").hidden = true;
  $("interview-intro").hidden = true;
  $("results-page").hidden = true;
  setWorkspace("setup");
  $("camera-check-page").hidden = false;
  document.title = "HyperSense AI · Camera check";
  refresh();
  $("camera-check-title").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (offerPermission) $("camera-on").onclick();
}

export function setWorkspace(space) {
  $("dashboard-page").hidden = true;
  const setup = $("session-setup");
  const interview = $("interview-workspace");
  const history = [...(document.querySelectorAll?.("section.card") || [])].find(
    (x) => x.querySelector("h2")?.textContent.trim() === "Saved interview sessions",
  );
  if (setup?.style) setup.style.display = space === "setup" ? "block" : "none";
  if (interview?.style) interview.style.display = space === "interview" ? "block" : "none";
  if (history) history.style.display = space === "history" ? "block" : "none";
  if (space === "interview") {
    $("live-camera-dock").appendChild($("camera-preview"));
    $("live-camera-dock").appendChild($("open-camera-check"));
    if (state.cameraStream)
      $("camera-video")
        .play()
        .catch(() => cameraMessage("Click Camera check to resume the preview."));
  }
}

export function setPageView(results) {
  $("camera-check-page").hidden = true;
  $("interview-page").hidden = results;
  $("interview-intro").hidden = results;
  $("results-page").hidden = !results;
  setWorkspace(results ? "history" : "setup");
  document.title = results
    ? "HyperSense AI · Interview results"
    : "HyperSense AI · Interview practice";
}

export function showResultsPage(id) {
  const path = "/results?session=" + encodeURIComponent(id);
  if (location.pathname + location.search !== path) history.pushState({}, "", path);
  setPageView(true);
  $("results-empty").hidden = true;
  $("results-title").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function showInterviewPage() {
  $("session-report")
    .querySelectorAll("audio")
    .forEach((player) => player.pause());
  if (location.pathname !== "/interview" || location.search)
    history.pushState({}, "", "/interview");
  setPageView(false);
  setWorkspace("interview");
  message("Interview workspace ready.");
  $("session-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

export function showSetupPage() {
  if (state.interviewSession?.active) {
    showInterviewPage();
    return;
  }
  cancelAutomation();
  cancelQuestionSpeech(false);
  clearInterval(state.ticker);
  state.ticker = null;
  state.current = null;
  stopCamera("Camera is off. Start a session to enable it with your consent.");
  $("session-report")
    .querySelectorAll("audio")
    .forEach((player) => player.pause());
  if (location.pathname !== "/interview" || location.search)
    history.pushState({}, "", "/interview");
  setPageView(false);
  message("Set up your next interview.");
  $("session-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

export async function restorePageRoute() {
  if (state.interviewSession?.active && location.pathname !== "/camera-check") {
    history.replaceState({}, "", "/interview");
    setPageView(false);
    setWorkspace("interview");
    return;
  }
  if (
    location.pathname === "/interview" &&
    new URLSearchParams(location.search).get("view") === "dashboard"
  ) {
    showDashboard();
    return;
  }
  if (location.pathname === "/camera-check") {
    showCameraCheck();
    return;
  }
  if (location.pathname !== "/results") {
    setPageView(false);
    return;
  }
  if (state.interviewSession?.active) {
    history.replaceState({}, "", "/interview");
    setPageView(false);
    return;
  }
  setPageView(true);
  const id = new URLSearchParams(location.search).get("session");
  if (id && state.interviewSession?.id === id) {
    $("results-empty").hidden = true;
    return;
  }
  $("session-report").hidden = true;
  $("results-empty").hidden = false;
  if (id) await openSavedSession(id);
}
export function initNavigation() {
  $("back-to-interview").onclick = showSetupPage;
  $("camera-check-back").onclick = () => {
    if (!state.busy && !state.recording) showSetupPage();
  };
  window.addEventListener("popstate", restorePageRoute);
}
