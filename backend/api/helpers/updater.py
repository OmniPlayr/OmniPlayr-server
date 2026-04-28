import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import hashlib

from api.helpers.config import get_config
from api.helpers.db import get_conn
from api.helpers.log import log
import tomllib

PRESERVED_PATHS = {
    "plugins",
    "config",
    "config.local.json",
    "logs",
    ".safe_mode",
}

def _fetch_remote_frontend_info(owner: str, repo: str, branch: str) -> dict:
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/frontend/src/config/version.toml"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OmniPlayr-Updater/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")

        import tomllib
        data = tomllib.loads(raw)

        frontend = data.get("version", {}).get("frontend", {})

        return {
            "version_tuple": (
                int(frontend.get("year", 0)),
                int(frontend.get("month", 0)),
                int(frontend.get("bugfix", 0)),
            ),
            "branch": frontend.get("branch", "main"),
            "safe_version": frontend.get("safeVersion", "0.0.0-main"),
        }

    except Exception as e:
        log(f"Failed to fetch remote frontend version: {e}", "error", "updater")
        return {
            "version_tuple": (0, 0, 0, "main"),
            "safe_version": "0.0.0-main",
        }

def _frontend_version_to_string(v: tuple) -> str:
    year, month, bugfix = v
    return f"{year}.{month}.{bugfix}"

def _get_current_info() -> dict:
    config_path = Path("config.json")
    if not config_path.exists():
        return {"version": "0.0.0", "branch": "main"}
    with open(config_path) as f:
        return json.load(f)

def _get_frontend_info() -> dict:
    path = Path("/frontend/src/config/version.toml")

    if not path.exists():
        return {
            "version_tuple": (0, 0, 0, "main"),
            "safe_version": "0.0.0-main",
            "branch": "main",
        }

    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))

        frontend = data.get("version", {}).get("frontend", {})

        year = int(frontend.get("year", 0))
        month = int(frontend.get("month", 0))
        bugfix = int(frontend.get("bugfix", 0))
        branch = frontend.get("branch", "main")
        safe_version = frontend.get("safeVersion", "0.0.0-main")

        return {
            "version_tuple": (year, month, bugfix),
            "branch": branch,
            "safe_version": safe_version,
        }
        
    except Exception as e:
        log(f"Frontend TOML parse failed: {e}", "error", "updater")
        return {
            "version_tuple": (0, 0, 0),
            "safe_version": "0.0.0-main",
            "branch": "main",
        }

def _parse_version(v: str) -> tuple:
    try:
        return tuple(int(x) for x in str(v).split("."))
    except Exception:
        return (0, 0, 0)


def _is_newer(latest: str, current: str) -> bool:
    return _parse_version(latest) > _parse_version(current)


def _is_frontend_newer(latest: tuple, current: tuple) -> bool:
    return latest > current


def _get_repo() -> tuple:
    owner = get_config("github.owner", "")
    repo = get_config("github.repo", "")
    if not owner or not repo:
        return None, None
    return owner, repo


def _fetch_remote_config(owner: str, repo: str, branch: str) -> dict | None:
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/backend/config.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OmniPlayr-Updater/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log(f"Failed to fetch remote config: {e}", "error", "updater")
        return None


def _tarball_url(owner: str, repo: str, branch: str) -> str:
    return f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.tar.gz"


def _load_cache() -> dict | None:
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, last_checked, latest_version, latest_frontend_version, update_available, tarball_url
                    FROM update_cache
                    WHERE id = 1
                """)
                return cur.fetchone()
    except Exception as e:
        log(f"Cache load failed: {e}", "error", "updater")
        return None

def _save_cache(latest_backend: str, latest_frontend: str, update_available: bool, tarball_url: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO update_cache (id, last_checked, latest_version, latest_frontend_version, update_available, tarball_url)
                VALUES (1, NOW(), %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    last_checked = NOW(),
                    latest_version = EXCLUDED.latest_version,
                    latest_frontend_version = EXCLUDED.latest_frontend_version,
                    update_available = EXCLUDED.update_available,
                    tarball_url = EXCLUDED.tarball_url
                """,
                (latest_backend, latest_frontend, update_available, tarball_url),
            )
        conn.commit()

def _cache_get(cache, key, index):
    try:
        return cache[key]
    except Exception:
        try:
            return cache[index]
        except Exception:
            return None

def check_for_updates(force: bool = False) -> dict:
    current = _get_current_info()
    frontend_current = _get_frontend_info()

    current_version = current.get("version", "0.0.0")
    branch = current.get("branch", "main")
    
    current_frontend_version = _frontend_version_to_string(frontend_current["version_tuple"])

    owner, repo = _get_repo()
    if not owner or not repo:
        return {
            "current_version": current_version,
            "update_available": False,
            "error": "GitHub repository not configured",
        }

    interval_hours = get_config("github.check_interval_hours", 24)
    cache = _load_cache()

    if not force and cache:
        last_checked = _cache_get(cache, "last_checked", 1)

        if last_checked:
            now = datetime.now()

            if hasattr(last_checked, "tzinfo") and last_checked.tzinfo:
                now = datetime.now(last_checked.tzinfo)

            age = now - last_checked

            if age < timedelta(hours=interval_hours):
                return {
                    "current_version": current_version,
                    "current_frontend_version": current_frontend_version,
                    "latest_version": _cache_get(cache, "latest_version", 2),
                    "latest_frontend_version": _cache_get(cache, "latest_frontend_version", 3),
                    "update_available": _cache_get(cache, "update_available", 4),
                    "tarball_url": _cache_get(cache, "tarball_url", 5),
                    "from_cache": True,
                }

    remote = _fetch_remote_config(owner, repo, branch)
    if remote is None:
        return {"error": "Could not reach GitHub"}

    latest_backend = remote.get("version", "0.0.0")
    remote_frontend = _fetch_remote_frontend_info(owner, repo, branch)

    backend_new = _is_newer(latest_backend, current_version)
    frontend_new = remote_frontend["version_tuple"] > frontend_current["version_tuple"]

    update_available = backend_new or frontend_new
    url = _tarball_url(owner, repo, branch)

    _save_cache(
        latest_backend,
        remote_frontend["safe_version"],
        update_available,
        url,
    )

    log(
        f"Update check backend={backend_new} frontend={frontend_new}",
        "info",
        "updater",
    )

    return {
        "current_version": current_version,
        "latest_version": latest_backend,
        "latest_frontend_version": remote_frontend["safe_version"],
        "update_available": update_available,
        "tarball_url": url,
        "from_cache": False,
    }
def _get_normalized_hash(path: Path) -> str:
    try:
        with open(path, "rb") as f:
            data = f.read()
        normalized_data = data.replace(b"\r\n", b"\n")
        return hashlib.md5(normalized_data).hexdigest()
    except Exception:
        return ""

def apply_update() -> dict:
    cache = _load_cache()
    if not cache:
        return {"error": "No update info available"}
    
    update_available = cache.get("update_available") if isinstance(cache, dict) else cache[4]
    tarball_url = cache.get("tarball_url") if isinstance(cache, dict) else cache[5]
    
    if not update_available:
        return {"error": "No update available"}

    app_dir = Path("/app")

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            tarball_path = tmp_path / "update.tar.gz"

            req = urllib.request.Request(tarball_url)
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(tarball_path, "wb") as f:
                    shutil.copyfileobj(resp, f)

            extract_path = tmp_path / "extracted"
            extract_path.mkdir()

            with tarfile.open(tarball_path, "r:gz") as tar:
                tar.extractall(extract_path, filter="data")

            source_root = next(extract_path.iterdir())
            
            with open(source_root / ".gitattributes", "w") as ga:
                ga.write("* text=auto\n")

            backend_source = source_root / "backend"
            frontend_source = source_root / "frontend"

            if backend_source.exists():
                _copy_update(backend_source, app_dir)

            if frontend_source.exists():
                _copy_update(frontend_source, Path("/frontend"))

        requirements = app_dir / "requirements.txt"
        if requirements.exists():
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements)])

        log("Backend and Frontend sync completed", "success", "updater")
        return {"status": "applied"}

    except Exception as e:
        log(f"Apply update failed: {e}", "error", "updater")
        return {"error": str(e)}

def _copy_update(source: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if item.name in PRESERVED_PATHS or item.is_symlink():
            continue

        target = dest / item.name

        if item.is_dir():
            _copy_update(item, target)
        else:
            should_copy = True
            if target.exists():
                if _get_normalized_hash(item) == _get_normalized_hash(target):
                    should_copy = False
            
            if should_copy:
                shutil.copy2(item, target)
                log(f"Updated: {target}", "info", "updater")