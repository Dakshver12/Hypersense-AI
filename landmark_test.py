import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


def main():
    model_path = Path(__file__).with_name("face_landmarker.task")

    if not model_path.is_file():
        raise FileNotFoundError("Download face_landmarker.task first.")

    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(
            model_asset_path=str(model_path)
        ),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
    )

    camera = cv2.VideoCapture(0)
    window_name = "HyperSense - Facial landmarks"
    previous_timestamp = -1

    try:
        if not camera.isOpened():
            raise RuntimeError(
                "Cannot open webcam. Close other apps using it."
            )

        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        with vision.FaceLandmarker.create_from_options(options) as detector:
            print("Click the camera window and press Q to exit.")

            while True:
                success, frame = camera.read()
                if not success:
                    raise RuntimeError("Could not read webcam frame.")

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb,
                )

                timestamp = max(
                    previous_timestamp + 1,
                    time.monotonic_ns() // 1_000_000,
                )
                previous_timestamp = timestamp

                result = detector.detect_for_video(image, timestamp)
                height, width = frame.shape[:2]

                for face in result.face_landmarks:
                    for point in face:
                        x = int(point.x * width)
                        y = int(point.y * height)
                        cv2.circle(frame, (x, y), 1, (0, 230, 150), -1)

                preview = cv2.flip(frame, 1)
                cv2.imshow(window_name, preview)

                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

                if cv2.getWindowProperty(
                    window_name, cv2.WND_PROP_VISIBLE
                ) < 1:
                    break

    finally:
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()