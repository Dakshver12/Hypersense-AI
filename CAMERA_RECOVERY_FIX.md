# Camera detection recovery

Replace matching files in the project root.

Detection now retries after 15 seconds when three backend requests fail instead of pausing indefinitely. The existing manual retry remains available. Frame capture has a 10-second timeout so a stalled mobile canvas callback cannot hold the detection loop busy forever.

Camera status now distinguishes: face found without usable head orientation; calibration sample progress; calibrated and ready. The existing five stable-sample requirement is preserved. This does not repair backend model errors or missing landmarks; those require the detect-face response/logs.

Full npm UI suite passed, including automatic recovery after three failed requests. Physical mobile camera behavior was not tested here.

```bash
git add static/js/camera.js tests/camera_recovery_ui.cjs tests/ui.cjs CAMERA_RECOVERY_FIX.md
git commit -m "Recover mobile face detection and expose calibration progress"
git push
```

After deployment, check the camera-status message. If it says head orientation unavailable, send the detect-face response and backend logs. If it retries repeatedly, send the failing request status and response.
