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

from api.helpers.config import get_config
from api.helpers.db import get_conn
from api.helpers.log import log

PRESERVED_PATHS = {
    "plugins",
    "config",
    "config.local.json",
    "logs",
    ".safe_mode",
}


def _get_current_info() -> dict:
    config_path = Path("config.json")
    if not config_path.exists():
        return {"version": "0.0.0", "branch": "main"}
    with open(config_path) as f:
        return json.load(f)


def _parse_version(v: str) -> tuple:
    try:
        return tuple(int(x) for x in str(v).split("."))
    except Exception:
        return (0, 0, 0)


def _is_newer(latest: str, current: str) -> bool:
    return _parse_version(latest) > _parse_version(current)


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
                cur.execute("SELECT * FROM update_cache WHERE id = 1")
                return cur.fetchone()
    except Exception:
        return None


def _save_cache(latest_version: str, update_available: bool, tarball_url: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO update_cache (id, last_checked, latest_version, update_available, tarball_url)
                VALUES (1, NOW(), %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    last_checked = NOW(),
                    latest_version = EXCLUDED.latest_version,
                    update_available = EXCLUDED.update_available,
                    tarball_url = EXCLUDED.tarball_url
                """,
                (latest_version, update_available, tarball_url),
            )
        conn.commit()


def check_for_updates(force: bool = False) -> dict:
    current = _get_current_info()
    current_version = current.get("version", "0.0.0")
    branch = current.get("branch", "main")

    owner, repo = _get_repo()
    if not owner or not repo:
        return {
            "current_version": current_version,
            "update_available": False,
            "error": "GitHub repository not configured. Set github.owner and github.repo in config/update.toml",
        }

    interval_hours = get_config("github.check_interval_hours", 24)
    cache = _load_cache()

    if not force and cache and cache["last_checked"]:
        age = datetime.now(cache["last_checked"].tzinfo) - cache["last_checked"]
        if age < timedelta(hours=interval_hours):
            return {
                "current_version": current_version,
                "latest_version": cache["latest_version"],
                "update_available": bool(cache["update_available"]),
                "tarball_url": cache["tarball_url"],
                "last_checked": cache["last_checked"].isoformat(),
                "from_cache": True,
            }

    remote = _fetch_remote_config(owner, repo, branch)
    if remote is None:
        result = {
            "current_version": current_version,
            "update_available": False,
            "error": "Could not reach GitHub to check for updates",
        }
        if cache and cache["last_checked"]:
            result["last_checked"] = cache["last_checked"].isoformat()
            result["latest_version"] = cache["latest_version"]
            result["update_available"] = bool(cache["update_available"])
        return result

    latest_version = remote.get("version", "0.0.0")
    update_available = _is_newer(latest_version, current_version)
    url = _tarball_url(owner, repo, branch)

    _save_cache(latest_version, update_available, url)
    log(
        f"Update check: current={current_version}, latest={latest_version}, update_available={update_available}",
        "info",
        "updater",
    )

    return {
        "current_version": current_version,
        "latest_version": latest_version,
        "update_available": update_available,
        "tarball_url": url,
        "last_checked": datetime.now().isoformat(),
        "from_cache": False,
    }


def apply_update() -> dict:
    cache = _load_cache()
    if not cache:
        return {"error": "No update info available. Run a check first."}
    if not cache["update_available"]:
        return {"error": "No update available"}

    tarball_url = cache["tarball_url"]
    app_dir = Path("/app")

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            tarball_path = tmp_path / "update.tar.gz"

            log(f"Downloading update from {tarball_url}", "info", "updater")
            req = urllib.request.Request(tarball_url, headers={"User-Agent": "OmniPlayr-Updater/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(tarball_path, "wb") as f:
                    shutil.copyfileobj(resp, f)

            log("Extracting update archive", "info", "updater")
            extract_path = tmp_path / "extracted"
            extract_path.mkdir()

            with tarfile.open(tarball_path, "r:gz") as tar:
                tar.extractall(extract_path, filter="data")

            extracted_dirs = list(extract_path.iterdir())
            if not extracted_dirs:
                return {"error": "Update archive is empty"}

            source_root = extracted_dirs[0]
            backend_source = source_root / "backend"
            if backend_source.exists():
                source_root = backend_source

            log("Applying update files", "info", "updater")
            _copy_update(source_root, app_dir)

        requirements = app_dir / "requirements.txt"
        if requirements.exists():
            log("Installing updated dependencies", "info", "updater")
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", str(requirements), "--quiet"],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                log(f"Dependency install warning: {result.stderr}", "warning", "updater")

        _save_cache(cache["latest_version"], False, cache["tarball_url"])
        log(f"Update to {cache['latest_version']} applied successfully", "success", "updater")
        return {"status": "applied", "version": cache["latest_version"]}

    except Exception as e:
        log(f"Update apply failed: {e}", "error", "updater")
        return {"error": f"Update failed: {str(e)}"}


def _copy_update(source: Path, dest: Path):
    for item in source.iterdir():
        if item.name in PRESERVED_PATHS:
            continue
        if item.is_symlink():
            continue
        dest_item = dest / item.name
        if item.is_dir():
            if dest_item.exists():
                shutil.rmtree(dest_item)
            shutil.copytree(item, dest_item, symlinks=False)
        else:
            shutil.copy2(item, dest_item)