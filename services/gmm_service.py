import cv2
import numpy as np
from typing import Dict, Optional
from models.camera_model import CameraModel


class GMMService:
    def __init__(self):
        self._cameras: Dict[str, CameraModel] = {}

    def init_camera(self, camera_id: str, description: str = "") -> CameraModel:
        cam = CameraModel(camera_id, description)
        self._cameras[camera_id] = cam
        return cam

    def get_camera(self, camera_id: str) -> Optional[CameraModel]:
        return self._cameras.get(camera_id)

    def get_or_init(self, camera_id: str) -> CameraModel:
        if camera_id not in self._cameras:
            self._cameras[camera_id] = CameraModel(camera_id)
        return self._cameras[camera_id]

    def remove_camera(self, camera_id: str) -> bool:
        if camera_id in self._cameras:
            del self._cameras[camera_id]
            return True
        return False

    def list_cameras(self) -> list[CameraModel]:
        return list(self._cameras.values())

    def decode_frame(self, raw_bytes: bytes) -> Optional[np.ndarray]:
        arr   = np.frombuffer(raw_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame

    def predict(self, camera_id: str, raw_bytes: bytes) -> dict:
        frame = self.decode_frame(raw_bytes)
        if frame is None:
            raise ValueError("Không thể decode frame — dữ liệu ảnh không hợp lệ")

        cam = self.get_or_init(camera_id)
        cam.latest_jpeg = raw_bytes          # ← lưu JPEG cho MJPEG stream
        result = cam.apply_frame(frame)

        return {
            **result,
            "camera_id"  : camera_id,
            "frame_count": cam.frame_count,
            "warming_up" : cam.is_warming_up,
        }


gmm_service = GMMService()