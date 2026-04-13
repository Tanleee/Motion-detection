# from fastapi import FastAPI
# from fastapi.staticfiles import StaticFiles
# from contextlib import asynccontextmanager

# # ✅ Đổi từ controllers → routes
# from routes.camera_routes import router as camera_router
# from routes.stream_routes import router as stream_router

# from config import settings

# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     print(f"🚀 Motion Detection Server khởi động tại {settings.HOST}:{settings.PORT}")
#     yield
#     print("🛑 Server dừng")

# app = FastAPI(
#     title       = "Motion Detection API",
#     description = "GMM Background Subtraction cho ESP32-CAM",
#     version     = "1.0.0",
#     lifespan    = lifespan,
# )

# app.mount("/static", StaticFiles(directory="views/static"), name="static")

# app.include_router(camera_router)
# app.include_router(stream_router)

# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)

import os
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Import routes của bạn ở đây
# from routes import camera_routes, dashboard_routes

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="views/static"), name="static")

# Include routers
# app.include_router(camera_routes.router)
# app.include_router(dashboard_routes.router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)