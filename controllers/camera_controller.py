import asyncio
from datetime import datetime
from fastapi import HTTPException
from fastapi.responses import StreamingResponse, Response
from models.schemas import PredictResponse, CameraStatusResponse
from services.gmm_service import gmm_service


# ── Camera CRUD ───────────────────────────────────────────────

def handle_init_camera(camera_id: str, description: str = ""):
    cam = gmm_service.init_camera(camera_id, description)
    return {
        "message"    : f"Camera '{camera_id}' đã khởi tạo",
        "camera_id"  : cam.camera_id,
        "description": cam.description,
    }


async def handle_predict(camera_id: str, raw_bytes: bytes) -> PredictResponse:
    try:
        result = gmm_service.predict(camera_id, raw_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return PredictResponse(
        camera_id        = result["camera_id"],
        motion_detected  = result["motion_detected"],
        foreground_ratio = result["foreground_ratio"],
        foreground_pixels= result["foreground_pixels"],
        total_pixels     = result["total_pixels"],
        warming_up       = result["warming_up"],
        frame_count      = result["frame_count"],
        timestamp        = datetime.now(),
    )


def handle_camera_status(camera_id: str) -> CameraStatusResponse:
    cam = gmm_service.get_camera(camera_id)
    if cam is None:
        raise HTTPException(404, f"Camera '{camera_id}' chưa được khởi tạo")

    return CameraStatusResponse(
        camera_id        = cam.camera_id,
        description      = cam.description,
        frame_count      = cam.frame_count,
        warming_up       = cam.is_warming_up,
        last_seen        = datetime.fromtimestamp(cam.last_seen) if cam.last_seen else None,
        is_active        = cam.is_active,
        motion_detected  = cam.last_motion_detected,
        foreground_ratio = cam.last_foreground_ratio,
        has_frame        = cam.latest_jpeg is not None,
    )


def handle_remove_camera(camera_id: str):
    removed = gmm_service.remove_camera(camera_id)
    if not removed:
        raise HTTPException(404, f"Camera '{camera_id}' không tồn tại")
    return {"message": f"Camera '{camera_id}' đã bị xoá"}


def handle_list_cameras():
    cameras = gmm_service.list_cameras()
    return [
        {
            "camera_id"  : c.camera_id,
            "description": c.description,
            "frame_count": c.frame_count,
            "is_active"  : c.is_active,
            "warming_up" : c.is_warming_up,
        }
        for c in cameras
    ]


# ── Stream handlers ───────────────────────────────────────────

async def handle_mjpeg_stream(camera_id: str) -> StreamingResponse:
    """
    MJPEG multipart stream.
    Browser chỉ cần đặt <img src="/api/cameras/{id}/mjpeg?api_key=...">
    """
    async def _generate():
        while True:
            cam = gmm_service.get_camera(camera_id)
            if cam and cam.latest_jpeg:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + cam.latest_jpeg
                    + b"\r\n"
                )
            # ~20 FPS tối đa; nếu ESP gửi chậm hơn thì browser giữ frame cũ
            await asyncio.sleep(0.05)

    return StreamingResponse(
        _generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


def handle_latest_frame(camera_id: str) -> Response:
    """Trả về JPEG mới nhất (dùng để polling thay vì MJPEG nếu cần)."""
    cam = gmm_service.get_camera(camera_id)
    if cam is None or cam.latest_jpeg is None:
        raise HTTPException(404, "Chưa có frame nào từ camera này")
    return Response(content=cam.latest_jpeg, media_type="image/jpeg")