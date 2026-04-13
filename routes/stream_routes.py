from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from controllers.stream_controller import handle_dashboard

router = APIRouter(tags=["dashboard"])

@router.get("/", response_class=HTMLResponse)
def dashboard():
    return handle_dashboard()