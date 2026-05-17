import cv2
import numpy as np
import time
from datetime import datetime
from typing import Optional
from config import settings


class CameraModel:
    def __init__(self, camera_id: str, description: str = ""):
        self.camera_id   = camera_id
        self.description = description
        self.frame_count = 0
        self.last_seen   : Optional[float] = None
        self.created_at  = datetime.now()

        # ── Lưu frame & kết quả mới nhất ──────────────
        self.latest_jpeg         : Optional[bytes] = None
        self.last_motion_detected: bool  = False
        self.last_foreground_ratio: float = 0.0

        self._subtractor = self._create_subtractor()

    def _create_subtractor(self):
        return cv2.createBackgroundSubtractorMOG2(
            history       = settings.GMM_HISTORY,
            varThreshold  = settings.GMM_VAR_THRESHOLD,
            detectShadows = settings.GMM_DETECT_SHADOW,
        )

    def _should_reset(self) -> bool:
        if self.last_seen is None:
            return False
        return (time.time() - self.last_seen) > settings.FRAME_TIMEOUT_SEC

    @property
    def is_warming_up(self) -> bool:
        return self.frame_count < settings.WARMUP_FRAMES

    @property
    def is_active(self) -> bool:
        if self.last_seen is None:
            return False
        return (time.time() - self.last_seen) < settings.FRAME_TIMEOUT_SEC

    def reset(self):
        self._subtractor = self._create_subtractor()
        self.frame_count  = 0
        self.latest_jpeg  = None

    def apply_frame(self, frame: np.ndarray) -> dict:
        now = time.time()
        if self._should_reset():
            self.reset()

        self.last_seen = now
        self.frame_count += 1

        fg_raw = self._subtractor.apply(frame)
        _, fg_binary = cv2.threshold(
            fg_raw, settings.BINARY_THRESHOLD, 255, cv2.THRESH_BINARY
        )
        k_open  = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (settings.MORPH_OPEN_SIZE, settings.MORPH_OPEN_SIZE)
        )
        k_close = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (settings.MORPH_CLOSE_SIZE, settings.MORPH_CLOSE_SIZE)
        )
        fg_clean = cv2.morphologyEx(fg_binary, cv2.MORPH_OPEN,  k_open)
        fg_clean = cv2.morphologyEx(fg_clean,  cv2.MORPH_CLOSE, k_close)

        total_pixels      = fg_clean.size
        foreground_pixels = int(np.sum(fg_clean > 0))
        foreground_ratio  = foreground_pixels / total_pixels
        motion_detected   = (
            not self.is_warming_up
            and foreground_ratio > settings.MOTION_RATIO_THRESHOLD
        )

        # Cập nhật kết quả cuối để status endpoint có thể đọc
        self.last_motion_detected  = motion_detected
        self.last_foreground_ratio = round(foreground_ratio, 4)

        return {
            "foreground_mask"  : fg_clean,
            "foreground_pixels": foreground_pixels,
            "total_pixels"     : total_pixels,
            "foreground_ratio" : self.last_foreground_ratio,
            "motion_detected"  : motion_detected,
        }