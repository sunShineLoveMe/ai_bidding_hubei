import json
import os
from pathlib import Path
from typing import Any

CONFIG_DIR = Path("config")
CONFIG_FILE = CONFIG_DIR / "runtime_settings.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "ai_provider": "dashscope",
    "text_model": "qwen-turbo-latest",
    "knowledge_model": "qwen-long",
    "embedding_model": "text-embedding-v3",
    "request_timeout_seconds": 120,
    "stream_connect_timeout_seconds": 15,
    "stream_read_timeout_seconds": 180,
    "upload_dir": "uploads/",
    "output_dir": "outputs/",
    "vector_store": "supabase_pgvector",
    "chroma_dir": "chroma_db/",
    "sqlite_db": "bidding.db",
    "onlyoffice_url": "http://localhost:8080",
    "backend_public_url": "http://host.docker.internal:3012",
    "word_template": "templates/default_bid_template.docx",
    "online_editing_enabled": True,
    "auto_backup_enabled": True,
    "backup_frequency": "daily",
    "backup_dir": "backups/",
}

ENV_MAPPING = {
    "ai_provider": "AI_PROVIDER",
    "text_model": "DASHSCOPE_MODEL",
    "knowledge_model": "DASHSCOPE_KNOWLEDGE_MODEL",
    "embedding_model": "DASHSCOPE_EMBEDDING_MODEL",
    "request_timeout_seconds": "DASHSCOPE_REQUEST_TIMEOUT_SECONDS",
    "stream_connect_timeout_seconds": "DASHSCOPE_STREAM_CONNECT_TIMEOUT_SECONDS",
    "stream_read_timeout_seconds": "DASHSCOPE_STREAM_READ_TIMEOUT_SECONDS",
    "upload_dir": "UPLOAD_DIR",
    "output_dir": "OUTPUT_DIR",
    "chroma_dir": "CHROMA_DIR",
    "sqlite_db": "SQLITE_DB_PATH",
    "onlyoffice_url": "ONLYOFFICE_DOCUMENT_SERVER_URL",
    "backend_public_url": "APP_PUBLIC_BASE_URL",
    "word_template": "WORD_TEMPLATE_PATH",
    "backup_dir": "BACKUP_DIR",
}

INT_KEYS = {
    "request_timeout_seconds",
    "stream_connect_timeout_seconds",
    "stream_read_timeout_seconds",
}

BOOL_KEYS = {
    "online_editing_enabled",
    "auto_backup_enabled",
}


def _coerce_value(key: str, value: Any) -> Any:
    if key in INT_KEYS:
        try:
            return int(value)
        except (TypeError, ValueError):
            return DEFAULT_SETTINGS[key]
    if key in BOOL_KEYS:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in {"1", "true", "yes", "on"}
    return value


def load_runtime_settings() -> dict[str, Any]:
    settings = dict(DEFAULT_SETTINGS)

    # Environment variables provide deploy-time defaults for open-source users.
    for key, env_key in ENV_MAPPING.items():
        env_value = os.getenv(env_key)
        if env_value not in {None, ""}:
            settings[key] = env_value

    # Runtime UI settings intentionally override non-sensitive env defaults so
    # changes from the settings page take effect without editing .env.
    if CONFIG_FILE.exists():
        try:
            saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                settings.update({key: saved[key] for key in DEFAULT_SETTINGS.keys() & saved.keys()})
        except json.JSONDecodeError:
            pass

    return {key: _coerce_value(key, value) for key, value in settings.items()}


def save_runtime_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_runtime_settings()
    allowed = {key: payload[key] for key in DEFAULT_SETTINGS.keys() & payload.keys()}
    current.update({key: _coerce_value(key, value) for key, value in allowed.items()})
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return load_runtime_settings()


def get_setting(key: str, default: Any = None) -> Any:
    return load_runtime_settings().get(key, default)
