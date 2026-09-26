import { initAccount } from "./account.js";
import { initMicrophoneCheck } from "./microphone-check.js";
import { initDashboardTabs } from "./dashboard-tabs.js";
import { initComparison } from "./comparison.js";
import { initPresets } from "./presets.js";
import { initBackup } from "./backup.js";
import { initTranscriptReview } from "./transcript-review.js";
import { initRecovery } from "./recovery.js";
import { initDelivery } from "./delivery.js";
import { initAutomation } from "./automation.js";
import { initSpeech } from "./speech.js";
import { initQuestions } from "./questions.js";
import { initSetup } from "./setup.js";
import { initUi } from "./ui.js";
import { initCamera } from "./camera.js";
import { initSessions } from "./sessions.js";
import { initRecording } from "./recording.js";
import { initResults } from "./results.js";
import { initLifecycle } from "./lifecycle.js";
import { initStorage } from "./storage.js";
import { initDashboard } from "./dashboard.js";
import { initNavigation } from "./navigation.js";
import { initBoot } from "./boot.js";

initDelivery();
initAutomation();
initSpeech();
initQuestions();
initSetup();
initUi();
initCamera();
initSessions();
initRecording();
initResults();
initLifecycle();
initStorage();
initDashboard();
initNavigation();
initTranscriptReview();
initBoot();

initRecovery();

initBackup();

initPresets();

initComparison();

initDashboardTabs();

initMicrophoneCheck();

initAccount();
