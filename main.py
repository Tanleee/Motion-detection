# import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from routes.camera_routes import router as camera_router
from routes.stream_routes import router as stream_router

from config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"🚀 Motion Detection Server khởi động")
    yield
    print("🛑 Server dừng")

app = FastAPI(
    title       = "Motion Detection API",
    description = "GMM Background Subtraction cho ESP32-CAM",
    version     = "1.0.0",
    lifespan    = lifespan,
)

app.mount("/static", StaticFiles(directory="views/static"), name="static")

app.include_router(camera_router)
app.include_router(stream_router)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", settings.PORT))  # ← đọc PORT từ Render
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)  # ← reload=False trên production