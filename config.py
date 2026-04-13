from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # GMM
    GMM_HISTORY       : int   = 500
    GMM_VAR_THRESHOLD : float = 16.0
    GMM_DETECT_SHADOW : bool  = True
    WARMUP_FRAMES     : int   = 200
    BINARY_THRESHOLD  : int   = 200
    MORPH_OPEN_SIZE   : int   = 3
    MORPH_CLOSE_SIZE  : int   = 7

    # Motion detection
    MOTION_RATIO_THRESHOLD : float = 0.01  # >1% pixel FG → có motion
    FRAME_TIMEOUT_SEC      : float = 5.0   # Reset nếu cam im >5s

    # Server
    HOST : str = "0.0.0.0"
    PORT : int = 8000

    class Config:
        env_file = ".env"

settings = Settings()