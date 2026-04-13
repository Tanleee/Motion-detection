from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# ── Request ──────────────────────────────
class CameraInitRequest(BaseModel):
    camera_id   : str
    description : Optional[str] = ""

# ── Response ─────────────────────────────
class PredictResponse(BaseModel):
    camera_id        : str
    motion_detected  : bool
    foreground_ratio : float          # tỷ lệ pixel FG (0.0 ~ 1.0)
    foreground_pixels: int
    total_pixels     : int
    warming_up       : bool           # True nếu chưa đủ warm-up frames
    frame_count      : int
    timestamp        : datetime

class CameraStatusResponse(BaseModel):
    camera_id    : str
    description  : str
    frame_count  : int
    warming_up   : bool
    last_seen    : Optional[datetime]
    is_active    : bool               # False nếu quá FRAME_TIMEOUT_SEC

class ErrorResponse(BaseModel):
    error   : str
    detail  : Optional[str] = None