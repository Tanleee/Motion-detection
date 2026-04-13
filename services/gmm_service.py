import cv2
import numpy as np
from typing import Dict, Optional
from models.camera_model import CameraModel

class GMMService:
    """
    Quản lý toàn bộ CameraModel.
    Đây là tầng Service — Controller gọi Service, không gọi Model trực tiếp.
    """

    def __init__(self):
        self._cameras: Dict[str, CameraModel] = {}

    # ── Camera management ─────────────────────────────────
    def init_camera(self, camera_id: str, description: str = "") -> CameraModel:
        cam = CameraModel(camera_id, description)
        self._cameras[camera_id] = cam
        return cam

    def get_camera(self, camera_id: str) -> Optional[CameraModel]:
        return self._cameras.get(camera_id)

    def get_or_init(self, camera_id: str) -> CameraModel:
        """Tự động khởi tạo nếu camera chưa tồn tại."""
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

    # ── Inference ─────────────────────────────────────────
    def decode_frame(self, raw_bytes: bytes) -> Optional[np.ndarray]:
        """Decode JPEG bytes từ ESP32-CAM → numpy array."""
        arr = np.frombuffer(raw_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame  # None nếu decode thất bại

    def predict(self, camera_id: str, raw_bytes: bytes) -> dict:
        """
        Nhận JPEG bytes, trả về kết quả detect motion.
        """
        frame = self.decode_frame(raw_bytes)
        if frame is None:
            raise ValueError("Không thể decode frame — dữ liệu ảnh không hợp lệ")

        cam    = self.get_or_init(camera_id)
        result = cam.apply_frame(frame)

        return {
            **result,
            "camera_id"  : camera_id,
            "frame_count": cam.frame_count,
            "warming_up" : cam.is_warming_up,
        }

# Singleton — dùng chung toàn app
gmm_service = GMMService()