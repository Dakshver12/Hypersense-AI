import cv2


def main():
    detector = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    if detector.empty():
        raise RuntimeError("Could not load the face detector.")

    camera = cv2.VideoCapture(0)

    try:
        if not camera.isOpened():
            raise RuntimeError(
                "Cannot open webcam. Check camera permissions "
                "and close other apps using it."
            )

        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        print("Camera started. Click the preview and press Q to exit.")

        while True:
            success, frame = camera.read()

            if not success:
                raise RuntimeError("Could not read a webcam frame.")

            # Mirror the preview for a natural webcam experience.
            frame = cv2.flip(frame, 1)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            faces = detector.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(60, 60),
            )

            for x, y, width, height in faces:
                cv2.rectangle(
                    frame,
                    (x, y),
                    (x + width, y + height),
                    (0, 220, 120),
                    2,
                )

            status = (
                f"Faces detected: {len(faces)}"
                if len(faces)
                else "No face detected"
            )

            cv2.putText(
                frame,
                status,
                (20, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2,
            )

            cv2.imshow("HyperSense - Camera test", frame)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

            if cv2.getWindowProperty(
                "HyperSense - Camera test", cv2.WND_PROP_VISIBLE
            ) < 1:
                break

    finally:
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()