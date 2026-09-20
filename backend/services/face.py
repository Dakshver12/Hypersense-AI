"""In-memory face landmark processing; no video recording."""

import math
import logging
from threading import Lock
from fastapi import UploadFile, HTTPException
from backend.config import PROJECT_ROOT

face_landmarker = None


face_lock = Lock()


def rotation_from_transform(matrix):
    import numpy as np

    block = np.asarray(matrix, dtype=float)[:3, :3]
    if block.shape != (3, 3) or not np.isfinite(block).all():
        return None
    u, _, vt = np.linalg.svd(block)
    correction = np.eye(3)
    correction[2, 2] = np.linalg.det(u @ vt)
    return (u @ correction @ vt).tolist()


def expression_observations(blendshapes, face_count):
    """Return visible movement coefficients for exactly one face."""
    if face_count != 1 or len(blendshapes) != 1:
        return None
    scores = {item.category_name: float(item.score) for item in blendshapes[0]}
    groups = {
        "mouth_corners_up": ("mouthSmileLeft", "mouthSmileRight"),
        "brows_raised": ("browInnerUp", "browOuterUpLeft", "browOuterUpRight"),
        "brows_lowered": ("browDownLeft", "browDownRight"),
        "jaw_open": ("jawOpen",),
    }
    output = {}
    for name, keys in groups.items():
        values = [scores.get(key) for key in keys]
        if any(
            (
                value is None or not math.isfinite(value) or (not 0 <= value <= 1)
                for value in values
            )
        ):
            return None
        output[name] = round(sum(values) / len(values), 4)
    return output


def detect_face(file: UploadFile):
    global face_landmarker
    import cv2
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    image_bytes = file.file.read(512 * 1024 + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The frame is empty.")
    if len(image_bytes) > 512 * 1024:
        raise HTTPException(status_code=413, detail="Camera frame is too large.")
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode camera frame.")
    height, width = image.shape[:2]
    if max(width, height) > 1280:
        raise HTTPException(
            status_code=413, detail="Use a frame up to 1280 pixels per side."
        )
    model_path = PROJECT_ROOT / "face_landmarker.task"
    if not model_path.is_file():
        raise HTTPException(
            status_code=503, detail="Place face_landmarker.task beside main.py."
        )
    try:
        with face_lock:
            if face_landmarker is None:
                options = vision.FaceLandmarkerOptions(
                    base_options=python.BaseOptions(model_asset_path=str(model_path)),
                    running_mode=vision.RunningMode.IMAGE,
                    num_faces=2,
                    output_facial_transformation_matrixes=True,
                    output_face_blendshapes=True,
                )
                face_landmarker = vision.FaceLandmarker.create_from_options(options)
            result = face_landmarker.detect(
                mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB),
                )
            )
        faces = []
        for points in result.face_landmarks:
            xs = [min(1.0, max(0.0, point.x)) for point in points]
            ys = [min(1.0, max(0.0, point.y)) for point in points]
            faces.append(
                {
                    "x": int(min(xs) * width),
                    "y": int(min(ys) * height),
                    "width": int((max(xs) - min(xs)) * width),
                    "height": int((max(ys) - min(ys)) * height),
                }
            )
        rotation = None
        if len(faces) == 1 and len(result.facial_transformation_matrixes) == 1:
            rotation = rotation_from_transform(result.facial_transformation_matrixes[0])
        return {
            "width": width,
            "height": height,
            "face_count": len(faces),
            "faces": faces,
            "rotation": rotation,
            "expressions": expression_observations(result.face_blendshapes, len(faces)),
        }
    except HTTPException:
        raise
    except Exception:
        logging.exception("Face landmark detection failed")
        raise HTTPException(
            status_code=500,
            detail="Face landmark detection failed. Check the server terminal.",
        ) from None
