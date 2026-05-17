from typing import Optional
from fastapi import APIRouter, UploadFile, File, Path, Query, Header, HTTPException

from controllers.camera_controller import (
    handle_init_camera, handle_predict, handle_camera_status,
    handle_remove_camera, handle_list_cameras,
    handle_mjpeg_stream, handle_latest_frame,
)
from models.schemas import PredictResponse, CameraStatusResponse
from services.auth_service import validate_api_key

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

# Camera ID dành riêng cho browser local — không cần auth
_LOCAL_CAM_ID = "web_client"


def _require_esp_auth(camera_id: str, api_key: Optional[str]):
    """Mọi camera_id khác web_client đều phải có API key hợp lệ."""
    if camera_id == _LOCAL_CAM_ID:
        return
    if not validate_api_key(api_key):
        raise HTTPException(403, "API key không hợp lệ hoặc bị thiếu")


def _require_key_query(api_key: str):
    """Dùng cho endpoint có api_key là query param (img src, frame)."""
    if not validate_api_key(api_key):
        raise HTTPException(403, "API key không hợp lệ")


# ── CRUD ─────────────────────────────────────────────────────

@router.post("/{camera_id}/init")
def init_camera(
    camera_id  : str,
    description: str = "",
    x_api_key  : Optional[str] = Header(None, alias="X-API-Key"),
):
    _require_esp_auth(camera_id, x_api_key)
    return handle_init_camera(camera_id, description)


@router.post("/{camera_id}/predict", response_model=PredictResponse,
             summary="Gửi frame (ESP32-CAM hoặc browser)")
async def predict(
    camera_id : str = Path(...),
    file      : UploadFile = File(...),
    x_api_key : Optional[str] = Header(None, alias="X-API-Key"),
):
    _require_esp_auth(camera_id, x_api_key)
    raw_bytes = await file.read()
    return await handle_predict(camera_id, raw_bytes)


@router.get("/{camera_id}/status", response_model=CameraStatusResponse)
def camera_status(camera_id: str):
    # Status là public — không lộ ảnh, chỉ lộ metadata
    return handle_camera_status(camera_id)


@router.delete("/{camera_id}")
def remove_camera(camera_id: str):
    return handle_remove_camera(camera_id)


@router.get("/", summary="Danh sách tất cả cameras")
def list_cameras():
    return handle_list_cameras()


# ── Streaming (yêu cầu API key) ───────────────────────────────

@router.get("/{camera_id}/mjpeg", summary="MJPEG stream từ ESP32-CAM")
async def mjpeg_stream(
    camera_id: str,
    api_key  : str = Query(..., description="API key xác thực chủ camera"),
):
    _require_key_query(api_key)
    return await handle_mjpeg_stream(camera_id)


@router.get("/{camera_id}/frame", summary="Lấy JPEG frame mới nhất")
def latest_frame(
    camera_id: str,
    api_key  : str = Query(...),
):
    _require_key_query(api_key)
    return handle_latest_frame(camera_id)