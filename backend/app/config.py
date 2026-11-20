import json
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DATABASE_PATH = Path(os.getenv("DATABASE_PATH") or BACKEND_DIR / "data" / "beepradar.db")
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = BACKEND_DIR / DATABASE_PATH

_registry_env = os.getenv("REGISTRY_PATH")
REGISTRY_PATH = (
    Path(_registry_env)
    if _registry_env
    else BACKEND_DIR.parent / "files" / "brain" / "sources_registry.json"
)

ATS_TOKENS_PATH = BACKEND_DIR / "data" / "ats_tokens.json"
CAREER_SEEDS_PATH = BACKEND_DIR / "data" / "career_pages.txt"

API_HOST = os.getenv("API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("API_PORT", "8000"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

USER_AGENT = os.getenv("USER_AGENT", "BeepRadarBot/1.0 (+https://localhost; contact: you@example.com)")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-haiku-5-5")
LLM_BATCH_SIZE = int(os.getenv("LLM_BATCH_SIZE", "10"))

STALE_DAYS = 14
FUZZY_THRESHOLD = 85.0


def load_registry() -> dict:
    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f)


def registry_sources() -> list[dict]:
    return load_registry()["sources"]


def source_config(source_id: str) -> dict | None:
    return next((s for s in registry_sources() if s["id"] == source_id), None)


def blocklist_domains() -> list[str]:
    return load_registry().get("blocklist_never_fetch", [])


def env_keys_present(source: dict) -> bool:
    required = source.get("api", {}).get("auth", {}).get("env", [])
    return all(os.getenv(k) for k in required)


def load_ats_tokens() -> dict:
    if ATS_TOKENS_PATH.exists():
        with open(ATS_TOKENS_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}