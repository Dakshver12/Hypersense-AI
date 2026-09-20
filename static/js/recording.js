import { resetTranscriptReview } from "./transcript-review.js";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { renderDelivery } from "./delivery.js";
import { pauseAutomation, autoProcessRecording } from "./automation.js";
import { cancelQuestionSpeech } from "./speech.js";
import { message } from "./setup.js";
import { refresh } from "./ui.js";
import { cameraReady } from "./camera.js";
import { updateAnswerTimer } from "./timer.js";
import { api, run } from "./api.js";

export function addRecordingPlayer(container, recording) {
  const player = document.createElement("audio");
  player.controls = true;
  player.preload = "metadata";
  player.setAttribute("aria-label", "Replay " + recording.name);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Play this recording here, or download a copy.";
  const actions = document.createElement("div");
  actions.className = "actions";
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "Play recording";
  const download = document.createElement("a");
  download.textContent = "Download " + recording.name;
  download.download = recording.name;
  download.className = "download-button";
  function setSource() {
    if (recording.blob instanceof Blob) {
      if (recording.url) URL.revokeObjectURL(recording.url);
      recording.url = URL.createObjectURL(recording.blob);
    }
    player.src = recording.url;
    download.href = recording.url;
    player.load();
  }
  player.onplay = () => {
    document.querySelectorAll("audio").forEach((other) => {
      if (other !== player) other.pause();
    });
    play.textContent = "Pause recording";
    status.textContent = "Playing recording.";
  };
  player.onpause = () => {
    play.textContent = "Play recording";
  };
  player.onended = () => {
    play.textContent = "Play recording";
    status.textContent = "Playback finished.";
  };
  player.onerror = () => {
    play.textContent = "Retry playback";
    const descriptions = {
      1: "Playback was interrupted.",
      2: "The browser could not load the saved audio.",
      3: "The browser could not decode this recording.",
      4: "The browser does not support this recording format or source.",
    };
    status.textContent =
      (descriptions[player.error?.code] || "Audio playback failed.") +
      " You can still download the file. Share this message if playback keeps failing.";
  };
  play.onclick = async () => {
    if (!player.paused) {
      player.pause();
      status.textContent = "Playback paused.";
      return;
    }
    try {
      if (player.error) setSource();
      if (player.ended) player.currentTime = 0;
      status.textContent = "Loading recording…";
      await player.play();
    } catch (error) {
      play.textContent = "Retry playback";
      status.textContent =
        error.name === "NotAllowedError"
          ? "The browser blocked playback. Allow sound for this page and click Play recording again."
          : "Could not play this recording (" +
            error.name +
            "). You can download it; share this message if retrying does not help.";
    }
  };
  actions.appendChild(play);
  actions.appendChild(download);
  container.appendChild(player);
  container.appendChild(actions);
  container.appendChild(status);
  setSource();
}

export function clearAudio() {
  resetTranscriptReview();
  state.deliveryAudio = null;
  const player = $("playback");
  player.pause();
  player.removeAttribute("src");
  player.load();
  player.hidden = true;
  $("recording-preview").hidden = true;
  $("download-recording").removeAttribute("href");
  $("download-recording").removeAttribute("download");
  $("recording-info").textContent = "";
  if (state.playUrl) URL.revokeObjectURL(state.playUrl);
  state.playUrl = "";
  state.blob = null;
  state.filename = "";
  if (!$("delivery-report").hidden) renderDelivery();
  $("upload").value = "";
}

export function setAudio(data, name) {
  clearAudio();
  if (!data || !data.size) {
    message("No audio was captured. Please record again.", true);
    refresh();
    return;
  }
  state.blob = data;
  state.filename = name;
  state.playUrl = URL.createObjectURL(data);
  $("playback").src = state.playUrl;
  $("playback").hidden = false;
  $("download-recording").href = state.playUrl;
  $("download-recording").download = state.filename;
  $("recording-info").textContent = state.filename + " · " + (data.size / 1024).toFixed(1) + " KB";
  $("recording-preview").hidden = false;
  $("transcript").value = "";
  $("result").hidden = true;
  refresh();
  if (!$("delivery-report").hidden) renderDelivery();
}

export function stopRecording() {
  clearTimeout(state.microphoneReadyTimer);
  if (state.media && state.media.state !== "inactive") state.media.stop();
}

export async function transcribeAnswer() {
  message(
    "Transcribing… Groq is primary when configured. Local fallback may take longer on first use.",
  );
  const form = new FormData();
  form.append("file", state.blob, state.filename);
  form.append("spoken_language", $("spoken").value);
  const data = await api("/transcribe", form, true);
  if (!data.text?.trim()) throw Error("No speech was returned.");
  state.deliveryAudio = data.delivery || null;
  renderDelivery();
  resetTranscriptReview();
  $("transcript").value = data.text;
  $("result").hidden = true;
  message(
    "Transcript: " +
      data.transcription_engine +
      " / " +
      data.transcription_model +
      " · " +
      data.transcription_seconds +
      " seconds. " +
      (data.transcription_notice || "") +
      " Review and correct recognition errors before submitting.",
  );
}
export function initRecording() {
  $("record").onclick = async () => {
    if ((state.interviewSession?.active || state.singlePractice) && !cameraReady()) {
      pauseAutomation("Camera required. Enable it and calibrate before recording.");
      return;
    }
    if (
      state.busy ||
      state.recording ||
      state.speechPending ||
      !state.current ||
      state.answerExpired ||
      state.answerSubmitted
    )
      return;
    cancelQuestionSpeech(false);
    state.busy = true;
    refresh();
    clearTimeout(state.microphoneReadyTimer);
    $("microphone-status").textContent = "Preparing microphone… Please wait before speaking.";
    message("Preparing microphone… Allow microphone access if prompted.");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error(
          "Microphone recording is unavailable. Open this page on localhost in Chrome or Edge, or upload audio.",
        );
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      updateAnswerTimer();
      if (state.answerExpired || state.answerSubmitted)
        throw Error("Answer time has expired. Start another question.");
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = mime
        ? new MediaRecorder(state.stream, { mimeType: mime })
        : new MediaRecorder(state.stream);
      state.media = recorder;
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstart = () => {
        // Capture a short lead-in before inviting speech. It stays in the recording.
        state.microphoneReadyTimer = setTimeout(() => {
          if (
            state.media !== recorder ||
            recorder.state !== "recording" ||
            state.answerExpired ||
            state.answerSubmitted
          )
            return;
          $("microphone-status").textContent = "Recording—speak now.";
          message("Recording—speak now. The microphone stops when time runs out.");
        }, 500);
      };
      recorder.onstop = () => {
        clearTimeout(state.microphoneReadyTimer);
        state.stream?.getTracks().forEach((t) => t.stop());
        state.recording = false;
        $("microphone-status").textContent =
          "Recording stopped. Replay the audio to check your opening.";
        const type = recorder.mimeType;
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        setAudio(new Blob(chunks, { type }), `answer.${ext}`);
        renderDelivery();
        message(
          state.answerExpired
            ? "Time is up. Recording saved; transcribe it and review recognition errors."
            : "Recording saved. Your answer timer is still running.",
        );
        refresh();
        if (state.blob?.size && !recorder.failed) autoProcessRecording();
      };
      recorder.onerror = () => {
        recorder.failed = true;
        pauseAutomation("Recording failed. Review or record again.");
        clearTimeout(state.microphoneReadyTimer);
        $("microphone-status").textContent = "Recording failed. Try again or upload audio.";
        message("Recording failed. Try again or upload audio.", true);
        stopRecording();
      };
      clearAudio();
      $("transcript").value = "";
      $("result").hidden = true;
      recorder.start();
      state.recording = true;
    } catch (err) {
      pauseAutomation("Microphone unavailable. Allow access, then use Record answer.");
      clearTimeout(state.microphoneReadyTimer);
      state.recording = false;
      state.stream?.getTracks().forEach((t) => t.stop());
      const text =
        err.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow access or upload a recording."
          : err.message;
      $("microphone-status").textContent = text;
      message(text, true);
    } finally {
      state.busy = false;
      refresh();
    }
  };
  $("stop").onclick = stopRecording;
  $("upload").onchange = () => {
    updateAnswerTimer();
    if (state.answerExpired || state.answerSubmitted) {
      $("upload").value = "";
      message("Answer time has expired. Generate a new question.", true);
      return;
    }
    const file = $("upload").files[0];
    if (!file) return;
    if (!file.size || file.size > 10 * 1024 * 1024) {
      message("Choose a nonempty audio file up to 10 MB.", true);
      $("upload").value = "";
      return;
    }
    setAudio(file, file.name);
    message("Audio selected. Click Transcribe audio.");
  };
  $("transcribe").onclick = () => run(transcribeAnswer);
}
