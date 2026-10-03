import { accountHeaders } from "./account-context.js";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { captureDeliveryPose, showExpressions } from "./delivery.js";
import { pauseAutomation } from "./automation.js";
import { message } from "./setup.js";
import { refresh } from "./ui.js";
import { stopRecording } from "./recording.js";
import { showCameraCheck } from "./navigation.js";

export function cameraReady() {
  return Boolean(
    state.cameraStream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && track.enabled) &&
    state.neutralRotation &&
    !state.calibrating,
  );
}

export function requireSessionCamera() {
  if (!cameraReady())
    throw Error(
      "Enable the camera and calibrate your neutral position before continuing the session.",
    );
}

export const frameCanvas = document.createElement("canvas");

export function cameraMessage(text) {
  if ($("camera-status").textContent !== text) $("camera-status").textContent = text;
  if (location.pathname === "/camera-check") message(text);
}

export function clearFaceBoxes() {
  const canvas = $("face-overlay");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

export function stopCamera(
  text = "Camera is required. Enable it and calibrate before starting a session.",
) {
  state.cameraSession++;
  state.detectionFailures = 0;
  $("retry-detection").hidden = true;
  resetPose();
  $("expression-live").textContent = "Camera is off.";
  state.cameraStarting = false;
  clearTimeout(state.faceTimeout);
  state.faceRequest?.abort();
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  $("camera-video").srcObject = null;
  $("camera-preview").hidden = true;
  clearFaceBoxes();
  $("camera-on").disabled = false;
  $("camera-off").disabled = true;
  cameraMessage(text);
  if (state.interviewSession?.active) {
    pauseAutomation(
      "Camera disconnected or turned off. Use Allow camera / retry to continue. Your answer is preserved.",
    );
    if (state.recording) stopRecording();
    showCameraCheck(false);
  }
  refresh();
}

export async function detectCameraFrame(session) {
  if (session !== state.cameraSession || !state.cameraStream) return;
  if (document.hidden || state.frameBusy) {
    if (document.hidden) {
      $("expression-live").textContent = "Facial movement updates paused while this tab is hidden.";
      state.latestRotation = null;
      $("calibrate").disabled = true;
      if (state.calibrating) state.calibrationSamples = [];
    }
    state.faceTimeout = setTimeout(() => detectCameraFrame(session), 800);
    return;
  }
  const video = $("camera-video");
  if (!video.videoWidth || video.readyState < 2) {
    cameraMessage(
      "Waiting for camera video frames. If the preview stays black, click Allow camera / retry.",
    );
    if (video.paused)
      video
        .play()
        .catch(() => cameraMessage("Video playback is blocked. Click Allow camera / retry."));
    state.faceTimeout = setTimeout(() => detectCameraFrame(session), 800);
    return;
  }
  state.frameBusy = true;
  let timeout;
  let retryDelay = 1000;
  const reportEpoch = state.deliveryEpoch;
  try {
    cameraMessage("Camera frames available. Waiting for face detection from the backend…");
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    frameCanvas.width = Math.round(video.videoWidth * scale);
    frameCanvas.height = Math.round(video.videoHeight * scale);
    frameCanvas.getContext("2d").drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    const image = await new Promise((resolve) => frameCanvas.toBlob(resolve, "image/jpeg", 0.75));
    if (session !== state.cameraSession) return;
    if (!image) throw Error("Could not capture a camera frame.");
    const form = new FormData();
    form.append("file", image, "frame.jpg");
    const controller = new AbortController();
    state.faceRequest = controller;
    timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch("/detect-face", {
      method: "POST",
      headers: accountHeaders(),
      body: form,
      signal: controller.signal,
    });
    const data = await response.json();
    if (session !== state.cameraSession) return;
    if (!response.ok)
      throw Error(typeof data.detail === "string" ? data.detail : "Face detection failed.");
    state.detectionFailures = 0;
    $("retry-detection").hidden = true;
    showExpressions(data, reportEpoch);
    captureDeliveryPose(data, reportEpoch);
    updatePose(data.rotation, data.face_count);
    const overlay = $("face-overlay");
    overlay.width = data.width;
    overlay.height = data.height;
    const ctx = overlay.getContext("2d");
    ctx.strokeStyle = "#76e3c4";
    ctx.lineWidth = 3;
    for (const face of data.faces) ctx.strokeRect(face.x, face.y, face.width, face.height);
    cameraMessage(
      data.face_count === 1
        ? "One face detected."
        : data.face_count > 1
          ? "Multiple faces detected. Keep only yourself in view."
          : "No face detected in this frame. Try facing the camera in better light.",
    );
  } catch (err) {
    if (session !== state.cameraSession) return;
    state.detectionFailures++;
    clearFaceBoxes();
    updatePose(null, 0); // Clear stale readings while retaining neutralRotation.
    $("expression-live").textContent = "Detection unavailable; camera preview remains on.";
    const reason =
      err.name === "AbortError"
        ? "Face detection took longer than 30 seconds."
        : "Face detection failed: " + err.message;
    if (state.detectionFailures >= 3) {
      retryDelay = null;
      $("retry-detection").hidden = false;
      cameraMessage(
        reason +
          " Detection paused after 3 failed attempts. Check the backend terminal, then click Retry face detection. Your camera and calibration are retained.",
      );
    } else {
      retryDelay = state.detectionFailures * 3000;
      cameraMessage(
        reason +
          " Camera stays on. Retrying detection in " +
          retryDelay / 1000 +
          " seconds (" +
          state.detectionFailures +
          "/3 failed attempts).",
      );
    }
  } finally {
    clearTimeout(timeout);
    state.frameBusy = false;
    if (session === state.cameraSession && state.cameraStream) {
      state.faceRequest = null;
      if (retryDelay !== null)
        state.faceTimeout = setTimeout(() => detectCameraFrame(session), retryDelay);
    }
  }
}

export function relativeAngles(base, currentRotation) {
  // Relative rotation is base transpose multiplied by the current rotation.
  const r = Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) =>
      base.reduce((sum, row, k) => sum + row[i] * currentRotation[k][j], 0),
    ),
  );
  const toDegrees = 180 / Math.PI;
  const cy = Math.hypot(r[0][0], r[1][0]);
  const pitch =
    Math.atan2(cy > 1e-6 ? r[2][1] : -r[1][2], cy > 1e-6 ? r[2][2] : r[1][1]) * toDegrees;
  const yaw = Math.atan2(-r[2][0], cy) * toDegrees;
  const roll = (cy > 1e-6 ? Math.atan2(r[1][0], r[0][0]) : 0) * toDegrees;
  const total =
    Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2))) * toDegrees;
  return { pitch, yaw, roll, total };
}

export function resetPose() {
  state.neutralRotation = null;
  state.latestRotation = null;
  state.calibrationSamples = [];
  state.calibrating = false;
  $("calibrate").disabled = true;
  for (const id of ["yaw", "pitch", "roll"]) $(id).textContent = "—";
  $("pose-status").textContent = "Enable the camera, then look toward it and calibrate.";
}

export function updatePose(rotation, count) {
  const valid =
    count === 1 &&
    Array.isArray(rotation) &&
    rotation.length === 3 &&
    rotation.every((row) => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite));
  state.latestRotation = valid ? rotation : null;
  if (valid && state.cameraStream && !state.neutralRotation && !state.calibrating) {
    state.calibrating = true;
    state.calibrationSamples = [];
  }
  $("calibrate").disabled = !valid || state.calibrating;
  if (!valid) {
    for (const id of ["yaw", "pitch", "roll"]) $(id).textContent = "—";
    if (state.calibrating) state.calibrationSamples = [];
    $("pose-status").textContent =
      count > 1
        ? "Head orientation unavailable: keep one face in view."
        : "Head orientation unavailable: no usable face landmarks.";
    return;
  }
  if (state.calibrating) {
    if (
      state.calibrationSamples.length &&
      relativeAngles(state.calibrationSamples[0], rotation).total > 8
    )
      state.calibrationSamples = [];
    state.calibrationSamples.push(rotation);
    $("pose-status").textContent =
      `Look toward the camera and hold still: ${state.calibrationSamples.length}/5 samples.`;
    if (state.calibrationSamples.length < 5) return;
    state.neutralRotation = rotation;
    state.calibrating = false;
    $("calibrate").disabled = false;
    refresh();
  }
  if (!state.neutralRotation) {
    $("pose-status").textContent = "Look toward the camera, then click Calibrate neutral position.";
    return;
  }
  const angles = relativeAngles(state.neutralRotation, rotation);
  // Magnitudes avoid confusing mirrored-preview left/right conventions.
  for (const id of ["yaw", "pitch", "roll"])
    $(id).textContent = Math.abs(angles[id]).toFixed(0) + "°";
  $("pose-status").textContent = "Approximate change from your neutral head position.";
}
export function initCamera() {
  $("camera-on").onclick = async () => {
    if (state.cameraStarting) return;
    if (state.cameraStream) {
      const video = $("camera-video");
      cameraMessage("Resuming camera preview and retrying face detection…");
      video.srcObject = state.cameraStream;
      video
        .play()
        .catch(() =>
          cameraMessage("Could not resume the preview. Turn the camera off, then retry."),
        );
      clearTimeout(state.faceTimeout);
      state.detectionFailures = 0;
      $("retry-detection").hidden = false;
      if (!state.frameBusy) detectCameraFrame(state.cameraSession);
      else
        cameraMessage(
          "A detection request is still running. It will time out after 30 seconds if the backend does not respond.",
        );
      return;
    }
    if (!$("camera-consent").checked) {
      cameraMessage("Camera stays off. Return to setup and check the camera consent box first.");
      return;
    }
    state.cameraStarting = true;
    const session = ++state.cameraSession;
    $("camera-on").disabled = true;
    $("camera-off").disabled = false;
    cameraMessage("Allow camera access in your browser.");
    let acquired;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("Open this page on localhost in Chrome or Edge.");
      acquired = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      if (session !== state.cameraSession) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      state.cameraStream = acquired;
      for (const track of acquired.getVideoTracks())
        track.onended = () => {
          if (session === state.cameraSession)
            stopCamera("Camera disconnected. Enable it to retry.");
        };
      $("camera-video").srcObject = acquired;
      $("camera-preview").hidden = false;
      // Do not let a pending play() promise prevent the detection loop starting.
      $("camera-video")
        .play()
        .catch((err) => {
          if (session === state.cameraSession)
            cameraMessage(
              "Camera playback could not start: " + err.message + ". Click Allow camera / retry.",
            );
        });
      if (session !== state.cameraSession) return;
      cameraMessage("Camera is on. Checking face detection…");
      detectCameraFrame(session);
    } catch (err) {
      acquired?.getTracks().forEach((track) => track.stop());
      if (session === state.cameraSession)
        stopCamera(
          err.name === "NotAllowedError"
            ? "Camera permission denied. Allow access in the browser and try again."
            : "Could not start camera: " + err.message,
        );
    } finally {
      if (session === state.cameraSession) {
        state.cameraStarting = false;
        $("camera-on").disabled = false;
      }
    }
  };
  $("camera-off").onclick = () => stopCamera();
  $("camera-consent").onchange = () => {
    if ($("single-camera-consent")) $("single-camera-consent").checked = $("camera-consent").checked;
    if (!$("camera-consent").checked && (state.cameraStream || state.cameraStarting))
      stopCamera("Camera consent withdrawn. Camera is off.");
    refresh();
  };
  $("retry-detection").onclick = () => {
    if (!state.cameraStream || state.frameBusy) return;
    clearTimeout(state.faceTimeout);
    state.detectionFailures = 0;
    $("retry-detection").hidden = true;
    cameraMessage("Retrying face detection. Camera and calibration retained.");
    detectCameraFrame(state.cameraSession);
  };
  $("calibrate").onclick = () => {
    if (!state.latestRotation || !state.cameraStream) return;
    state.deliveryPose = [];
    state.deliveryFrames = 0;
    state.calibrating = true;
    state.calibrationSamples = [];
    state.neutralRotation = null;
    $("calibrate").disabled = true;
    refresh();
    for (const id of ["yaw", "pitch", "roll"]) $(id).textContent = "—";
    $("pose-status").textContent =
      "Look toward the camera and hold still for five samples (about 4–6 seconds).";
  };
}
