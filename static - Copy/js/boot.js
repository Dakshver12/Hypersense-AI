import { $ } from "./dom.js";
import { renderHistory } from "./delivery.js";
import { refresh } from "./ui.js";
import { renderSavedSessions } from "./history.js";
import { restorePageRoute } from "./navigation.js";

export function initBoot() {
  const liveCameraDock = document.createElement("section");
  liveCameraDock.id = "live-camera-dock";
  liveCameraDock.className = "card";
  const liveCameraTitle = document.createElement("h2");
  liveCameraTitle.textContent = "Live camera";
  liveCameraDock.appendChild(liveCameraTitle);
  liveCameraDock.appendChild($("open-camera-check"));
  const questionCard = $("question").closest("section");
  const questionCameraRow = document.createElement("div");
  questionCameraRow.className = "question-camera-row";
  questionCard.before(questionCameraRow);
  questionCameraRow.appendChild(questionCard);
  questionCameraRow.appendChild(liveCameraDock);
  renderHistory();
  refresh();
  renderSavedSessions();
  restorePageRoute();
}
