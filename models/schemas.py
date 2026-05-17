from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CameraInitRequest(BaseModel):
    camera_id   : str
    description : Optional[str] = ""


class PredictResponse(BaseModel):
    camera_id        : str
    motion_detected  : bool
    foreground_ratio : float
    foreground_pixels: int
    total_pixels     : int
    warming_up       : bool
    frame_count      : int
    timestamp        : datetime


class CameraStatusResponse(BaseModel):
    camera_id            : str
    description          : str
    frame_count          : int
    warming_up           : bool
    last_seen            : Optional[datetime]
    is_active            : bool
    # ── Thêm để dashboard ESP đọc được kết quả GMM ──
    motion_detected      : bool  = False
    foreground_ratio     : float = 0.0
    has_frame            : bool  = False   # True nếu đã có JPEG để stream


class ErrorResponse(BaseModel):
    error  : str
    detail : Optional[str] = None