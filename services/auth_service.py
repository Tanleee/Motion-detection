from config import settings


def validate_api_key(key: str | None) -> bool:
    """Trả về True nếu key nằm trong danh sách API_KEYS."""
    if not key or not settings.API_KEYS.strip():
        return False
    valid = {k.strip() for k in settings.API_KEYS.split(",") if k.strip()}
    return key in valid