from fastapi import APIRouter, UploadFile, File, Path
from controllers.camera_controller import (
    handle_init_camera,
    handle_predict,
    handle_camera_status,
    handle_remove_camera,
    handle_list_cameras,
)
from models.schemas import PredictResponse, CameraStatusResponse

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.post("/{camera_id}/init", summary="Khởi tạo camera mới")
def init_camera(camera_id: str, description: str = ""):
    return handle_init_camera(camera_id, description)


@router.post("/{camera_id}/predict", response_model=PredictResponse,
             summary="Gửi frame từ ESP32-CAM để detect motion")
async def predict(
    camera_id: str = Path(..., description="ID của camera"),
    file: UploadFile = File(..., description="Frame JPEG từ ESP32-CAM"),
):
    raw_bytes = await file.read()
    return await handle_predict(camera_id, raw_bytes)


@router.get("/{camera_id}/status", response_model=CameraStatusResponse,
            summary="Xem trạng thái camera")
def camera_status(camera_id: str):
    return handle_camera_status(camera_id)


@router.delete("/{camera_id}", summary="Xoá camera & reset background")
def remove_camera(camera_id: str):
    return handle_remove_camera(camera_id)


@router.get("/", summary="Danh sách tất cả cameras")
def list_cameras():
    return handle_list_cameras()