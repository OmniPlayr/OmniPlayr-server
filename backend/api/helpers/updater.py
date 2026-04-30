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
import fnmatch

import hashlib

from api.helpers.config import get_config
from api.helpers.db import get_conn
from api.helpers.log import log
import tomllib

import asyncio

ROOT_PRESERVED = {
    "backend",
    "frontend",
    ".git",
    ".github",
    ".gitignore",
    ".gitattributes",
    "README.md",
    "db",
    "logs",
    "user_storage",
    ".env",
}

BACKEND_PRESERVED = {
    "plugins",
    "config",
    "config.local.json",
    "logs",
    ".safe_mode",
}

FRONTEND_PRESERVED = {
}

_OVERWRITE_ALWAYS = {
    Path("frontend/src/config/version.toml"),
}

def _normalize_version_str(v: str) -> str:
    try:
        if not v:
            return v
        return v.split("-")[0]
    except Exception:
        return v


def _fetch_remote_frontend_info(owner: str, repo: str, branch: str) -> dict:
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/frontend/src/config/version.toml"
    log(f"Fetching remote frontend version info from {url!r}", "debug", "updater")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OmniPlayr-Updater/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")

        log(f"Remote frontend version.toml fetched ({len(raw)} bytes)", "debug", "updater")

        import tomllib
        data = tomllib.loads(raw)

        frontend = data.get("version", {}).get("frontend", {})
        log(f"Remote frontend section parsed: {frontend}", "debug", "updater")

        safe_version = _normalize_version_str(frontend.get("safeVersion", "0.0.0-main"))
        version_tuple = (
            int(frontend.get("year", 0)),
            int(frontend.get("month", 0)),
            int(frontend.get("bugfix", 0)),
        )

        log(f"Remote frontend version_tuple={version_tuple} safe_version={safe_version!r} branch={frontend.get('branch', 'main')!r}", "debug", "updater")

        return {
            "version_tuple": version_tuple,
            "branch": frontend.get("branch", "main"),
            "safe_version": safe_version,
        }

    except Exception as e:
        log(f"Failed to fetch remote frontend version: {e}", "error", "updater")
        return {
            "version_tuple": (0, 0, 0, "main"),
            "safe_version": "0.0.0",
        }


def _get_frontend_info() -> dict:
    path = Path("/frontend/src/config/version.toml")
    log(f"Reading local frontend version from {path}", "debug", "updater")

    if not path.exists():
        log(f"Local frontend version.toml not found at {path}, returning defaults", "debug", "updater")
        return {
            "version_tuple": (0, 0, 0),
            "safe_version": "0.0.0",
            "branch": "main",
        }

    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))

        frontend = data.get("version", {}).get("frontend", {})
        log(f"Local frontend section parsed: {frontend}", "debug", "updater")

        year = int(frontend.get("year", 0))
        month = int(frontend.get("month", 0))
        bugfix = int(frontend.get("bugfix", 0))
        branch = frontend.get("branch", "main")
        safe_version = _normalize_version_str(frontend.get("safeVersion", "0.0.0-main"))

        log(f"Local frontend version_tuple=({year},{month},{bugfix}) branch={branch!r} safe_version={safe_version!r}", "debug", "updater")

        return {
            "version_tuple": (year, month, bugfix),
            "branch": branch,
            "safe_version": safe_version,
        }

    except Exception as e:
        log(f"Frontend TOML parse failed: {e}", "error", "updater")
        return {
            "version_tuple": (0, 0, 0),
            "safe_version": "0.0.0",
            "branch": "main",
        }

def _to_linux_path(path: str) -> str:
    if len(path) >= 2 and path[1] == ":" and path[0].isalpha():
        drive = path[0].lower()
        rest = path[2:].replace("\\", "/")
        linux_path = f"/run/desktop/mnt/host/{drive}{rest}"
        log(f"Converted Windows path {path!r} -> {linux_path!r}", "debug", "updater")
        return linux_path
    return path


def _hard_restart():
    log("Initiating hard restart", "debug", "updater")
    try:
        in_docker = os.path.exists("/.dockerenv")

        if in_docker:
            result = subprocess.run(
                ["docker", "inspect", "omniplayr_backend", "--format",
                 "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"],
                capture_output=True, text=True, check=True
            )
            raw_compose_dir = result.stdout.strip()

            if not raw_compose_dir:
                raise RuntimeError("Could not read compose working dir from container labels")

            log(f"Raw compose dir from labels: {raw_compose_dir!r}", "debug", "updater")
            host_compose_dir = _to_linux_path(raw_compose_dir)

            update_cmd = (
                f"cd '{host_compose_dir}' && "
                f"docker compose down --remove-orphans --timeout 30 && "
                f"docker rm -f omniplayr_db omniplayr_frontend omniplayr_backend omniplayr_pgadmin 2>/dev/null || true && "
                f"docker compose build backend && "
                f"docker compose up -d"
            )

            subprocess.Popen([
                "docker", "run", "--rm",
                "--name", "omniplayr_updater",
                "-v", "/var/run/docker.sock:/var/run/docker.sock",
                "-v", f"{host_compose_dir}:{host_compose_dir}",
                "--workdir", host_compose_dir,
                "docker:latest",
                "sh", "-c", update_cmd,
            ])
            log("Detached update container spawned", "debug", "updater")

        else:
            subprocess.Popen(["reboot"])

    except Exception as e:
        log(f"Hard restart failed: {e}", "error", "updater")
        os._exit(1)

def _frontend_version_to_string(v: tuple) -> str:
    year, month, bugfix = v
    return f"{year}.{month}.{bugfix}"

def _get_current_info() -> dict:
    config_path = Path("config.json")
    log(f"Reading current backend info from {config_path}", "debug", "updater")

    if not config_path.exists():
        log(f"{config_path} not found, returning defaults", "debug", "updater")
        return {"version": "0.0.0", "branch": "main"}

    with open(config_path) as f:
        data = json.load(f)

    log(f"Current backend info: version={data.get('version', '?')!r} branch={data.get('branch', '?')!r}", "debug", "updater")
    return data

def _parse_version(v: str) -> tuple:
    try:
        parsed = tuple(int(x) for x in str(v).split("."))
        log(f"Parsed version {v!r} -> {parsed}", "debug", "updater")
        return parsed
    except Exception:
        log(f"Failed to parse version {v!r}, returning (0,0,0)", "debug", "updater")
        return (0, 0, 0)


def _is_newer(latest: str, current: str) -> bool:
    result = _parse_version(latest) > _parse_version(current)
    log(f"Backend version comparison: latest={latest!r} current={current!r} is_newer={result}", "debug", "updater")
    return result


def _is_frontend_newer(latest: tuple, current: tuple) -> bool:
    result = latest > current
    log(f"Frontend version comparison: latest={latest} current={current} is_newer={result}", "debug", "updater")
    return result


def _get_repo() -> tuple:
    log("Fetching GitHub repo config", "debug", "updater")
    owner = get_config("github.owner", "")
    repo = get_config("github.repo", "")
    if not owner or not repo:
        log("GitHub owner or repo not configured", "debug", "updater")
        return None, None
    log(f"GitHub repo configured: {owner!r}/{repo!r}", "debug", "updater")
    return owner, repo


def _fetch_remote_config(owner: str, repo: str, branch: str) -> dict | None:
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/backend/config.json"
    log(f"Fetching remote backend config from {url!r}", "debug", "updater")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OmniPlayr-Updater/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        log(f"Remote backend config fetched: version={data.get('version', '?')!r}", "debug", "updater")
        return data
    except Exception as e:
        log(f"Failed to fetch remote config: {e}", "error", "updater")
        return None


def _tarball_url(owner: str, repo: str, branch: str) -> str:
    url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.tar.gz"
    log(f"Tarball URL built: {url!r}", "debug", "updater")
    return url


def _load_cache() -> dict | None:
    log("Loading update cache from database", "debug", "updater")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, last_checked, latest_version, latest_frontend_version, update_available, tarball_url
                    FROM update_cache
                    WHERE id = 1
                """)
                row = cur.fetchone()
        if row:
            log(f"Cache hit: last_checked={_cache_get(row, 'last_checked', 1)} update_available={_cache_get(row, 'update_available', 4)}", "debug", "updater")
        else:
            log("No cache row found (id=1)", "debug", "updater")
        return row
    except Exception as e:
        log(f"Cache load failed: {e}", "error", "updater")
        return None

def _save_cache(latest_backend: str, latest_frontend: str, update_available: bool, tarball_url: str):
    log(f"Saving update cache: backend={latest_backend!r} frontend={latest_frontend!r} update_available={update_available} url={tarball_url!r}", "debug", "updater")
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
    log("Update cache saved successfully", "debug", "updater")

def _cache_get(cache, key, index):
    try:
        return cache[key]
    except Exception:
        try:
            return cache[index]
        except Exception:
            return None

def check_for_updates(force: bool = False) -> dict:
    log(f"check_for_updates called with force={force}", "debug", "updater")

    current = _get_current_info()
    frontend_current = _get_frontend_info()

    current_version = current.get("version", "0.0.0")
    branch = current.get("branch", "main")
    current_frontend_version = _normalize_version_str(_frontend_version_to_string(frontend_current["version_tuple"]))

    log(f"Current state: backend={current_version!r} frontend={current_frontend_version!r} branch={branch!r}", "debug", "updater")

    owner, repo = _get_repo()
    if not owner or not repo:
        log("GitHub repo not configured, aborting update check", "debug", "updater")
        return {
            "current_version": current_version,
            "update_available": False,
            "error": "GitHub repository not configured",
        }

    interval_hours = get_config("github.check_interval_hours", 24)
    log(f"Update check interval: {interval_hours}h", "debug", "updater")

    cache = _load_cache()

    if not force and cache:
        last_checked = _cache_get(cache, "last_checked", 1)
        log(f"Cache found, last_checked={last_checked}", "debug", "updater")

        if last_checked:
            now = datetime.now()

            if hasattr(last_checked, "tzinfo") and last_checked.tzinfo:
                now = datetime.now(last_checked.tzinfo)

            age = now - last_checked
            log(f"Cache age: {age} (limit: {interval_hours}h)", "debug", "updater")

            if age < timedelta(hours=interval_hours):
                log("Cache is fresh, returning cached result", "debug", "updater")
                return {
                    "current_version": current_version,
                    "latest_version": _cache_get(cache, "latest_version", 2),
                    "latest_frontend_version": _normalize_version_str(_cache_get(cache, "latest_frontend_version", 3)),
                    "current_frontend_version": current_frontend_version,
                    "update_available": _cache_get(cache, "update_available", 4),
                    "tarball_url": _cache_get(cache, "tarball_url", 5),
                    "from_cache": True,
                }
            else:
                log("Cache expired, fetching fresh data", "debug", "updater")
    elif force:
        log("force=True, skipping cache", "debug", "updater")
    else:
        log("No cache found, fetching fresh data", "debug", "updater")

    remote = _fetch_remote_config(owner, repo, branch)
    if remote is None:
        log("Remote config fetch returned None, aborting", "debug", "updater")
        return {"error": "Could not reach GitHub"}

    latest_backend = remote.get("version", "0.0.0")
    log(f"Remote backend version: {latest_backend!r}", "debug", "updater")

    remote_frontend = _fetch_remote_frontend_info(owner, repo, branch)
    log(f"Remote frontend version_tuple={remote_frontend['version_tuple']} safe_version={remote_frontend.get('safe_version')!r}", "debug", "updater")

    backend_new = _is_newer(latest_backend, current_version)
    frontend_new = remote_frontend["version_tuple"] > frontend_current["version_tuple"]
    update_available = backend_new or frontend_new

    log(f"Update check result: backend_new={backend_new} frontend_new={frontend_new} update_available={update_available}", "debug", "updater")

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
        "latest_frontend_version": _normalize_version_str(remote_frontend["safe_version"]),
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


def _is_in_config_dir(path: Path) -> bool:
    return any(part == "config" for part in path.parts)


def _is_config_types_file(path: Path) -> bool:
    stem = path.stem.lower()
    return "types" in stem or "config_types" in path.parts


def _is_mergeable_config(path: Path, root: Path) -> bool:
    if path.suffix not in (".toml", ".json"):
        return False
    if _is_config_types_file(path):
        return False
    if path.relative_to(root) in _OVERWRITE_ALWAYS:
        return False
    return _is_in_config_dir(path)

def _toml_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f'"{value}"'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    return repr(value)


def _merge_toml_file(source: Path, dest: Path):
    log(f"Merging TOML config: source={source} dest={dest}", "debug", "updater")

    try:
        source_data = tomllib.loads(source.read_text(encoding="utf-8"))
        dest_data = tomllib.loads(dest.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"TOML merge parse failed for {dest}: {e}", "error", "updater")
        return

    log(f"TOML source has {len(source_data)} top-level key(s), dest has {len(dest_data)}", "debug", "updater")

    to_add: dict[str | None, list[tuple]] = {}

    for key, value in source_data.items():
        if isinstance(value, dict):
            new_keys = {k: v for k, v in value.items() if k not in dest_data.get(key, {})}
            if new_keys:
                log(f"TOML section [{key}]: {len(new_keys)} new key(s) to add: {list(new_keys.keys())}", "debug", "updater")
                to_add[key] = list(new_keys.items())
            else:
                log(f"TOML section [{key}]: no new keys", "debug", "updater")
        else:
            if key not in dest_data:
                log(f"TOML top-level key {key!r} is new, will add", "debug", "updater")
                to_add.setdefault(None, []).append((key, value))
            else:
                log(f"TOML top-level key {key!r} already exists, skipping", "debug", "updater")

    if not to_add:
        log(f"No new keys to add to {dest}, skipping write", "debug", "updater")
        return

    log(f"Adding keys to {len(to_add)} section(s) in {dest}", "debug", "updater")

    lines = dest.read_text(encoding="utf-8").splitlines(keepends=True)

    sections: list[tuple[str, int]] = []
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("[") and not s.startswith("[[") and "]" in s:
            sections.append((s[1:s.index("]")], i))

    log(f"Found {len(sections)} section(s) in dest file: {[n for n, _ in sections]}", "debug", "updater")

    insertions: dict[int, list[str]] = {}

    for i, (name, start) in enumerate(sections):
        if name not in to_add:
            continue
        end = sections[i + 1][1] if i + 1 < len(sections) else len(lines)
        new_lines = [f"{k} = {_toml_value(v)}\n" for k, v in to_add[name]]
        log(f"Queuing {len(new_lines)} line(s) for insertion at line {end} (end of [{name}])", "debug", "updater")
        insertions.setdefault(end, []).extend(new_lines)

    result: list[str] = []
    for i, line in enumerate(lines):
        if i in insertions:
            result.extend(insertions[i])
        result.append(line)
    if len(lines) in insertions:
        result.extend(insertions[len(lines)])

    sections_found = {name for name, _ in sections}
    for name, kvs in to_add.items():
        if name is None or name in sections_found:
            continue
        log(f"Section [{name}] not found in dest, appending new section at end", "debug", "updater")
        if result and result[-1].strip():
            result.append("\n")
        result.append(f"[{name}]\n")
        result.extend(f"{k} = {_toml_value(v)}\n" for k, v in kvs)

    if None in to_add:
        new_lines = [f"{k} = {_toml_value(v)}\n" for k, v in to_add[None]]
        log(f"Inserting {len(new_lines)} top-level key(s) before first section", "debug", "updater")
        first_section = next(
            (i for i, l in enumerate(result) if l.strip().startswith("[")),
            len(result),
        )
        result = result[:first_section] + new_lines + result[first_section:]

    dest.write_text("".join(result), encoding="utf-8")
    log(f"Merged config (TOML): {dest}", "info", "updater")


def _deep_merge_json(source: dict, dest: dict) -> dict:
    result = dict(dest)
    for key, value in source.items():
        if key not in result:
            result[key] = value
        elif isinstance(value, dict) and isinstance(result[key], dict):
            result[key] = _deep_merge_json(value, result[key])
    return result


def _merge_json_file(source: Path, dest: Path):
    log(f"Merging JSON config: source={source} dest={dest}", "debug", "updater")

    try:
        source_data = json.loads(source.read_text(encoding="utf-8"))
        dest_data = json.loads(dest.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"JSON merge parse failed for {dest}: {e}", "error", "updater")
        return

    if not isinstance(source_data, dict) or not isinstance(dest_data, dict):
        log(f"JSON merge skipped for {dest}: one or both files are not objects", "debug", "updater")
        return

    log(f"JSON source has {len(source_data)} key(s), dest has {len(dest_data)}", "debug", "updater")

    merged = _deep_merge_json(source_data, dest_data)

    if merged == dest_data:
        log(f"No new keys found in {source}, skipping write", "debug", "updater")
        return

    new_keys = set(merged.keys()) - set(dest_data.keys())
    log(f"JSON merge adding {len(new_keys)} top-level key(s): {new_keys}", "debug", "updater")

    dest.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"Merged config (JSON): {dest}", "info", "updater")


def _merge_or_copy(source: Path, target: Path, root: Path):
    log(f"_merge_or_copy: source={source} target={target} root={root}", "debug", "updater")

    if target.exists() and _is_mergeable_config(source, root):
        log(f"{source.name!r} is a mergeable config file, attempting merge", "debug", "updater")
        if source.suffix == ".toml":
            _merge_toml_file(source, target)
        elif source.suffix == ".json":
            _merge_json_file(source, target)
        else:
            log(f"Unknown mergeable extension {source.suffix!r} for {source}, falling back to copy", "debug", "updater")
            shutil.copy2(source, target)
            log(f"Updated: {target}", "info", "updater")
    else:
        if not target.exists():
            log(f"Target does not exist yet, copying {source.name!r}", "debug", "updater")
        elif _is_config_types_file(source):
            log(f"{source.name!r} is a config_types file, overwriting", "debug", "updater")
        else:
            log(f"{source.name!r} is not a mergeable config, overwriting", "debug", "updater")
        shutil.copy2(source, target)
        log(f"Updated: {target}", "info", "updater")


def apply_update() -> dict:
    log("apply_update called", "debug", "updater")

    cache = _load_cache()
    if not cache:
        log("No cache found, cannot apply update", "debug", "updater")
        return {"error": "No update info available"}

    update_available = cache.get("update_available") if isinstance(cache, dict) else cache[4]
    tarball_url = cache.get("tarball_url") if isinstance(cache, dict) else cache[5]

    log(f"Cache state: update_available={update_available} tarball_url={tarball_url!r}", "debug", "updater")

    if not update_available:
        log("No update available in cache, aborting", "debug", "updater")
        return {"error": "No update available"}

    raw_compose_dir = get_config("paths.compose_dir", "/compose")
    compose_dir = Path(_to_linux_path(raw_compose_dir))
    log(f"compose_dir={compose_dir} (raw={raw_compose_dir!r})", "debug", "updater")

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            tarball_path = tmp_path / "update.tar.gz"

            log(f"Downloading tarball from {tarball_url!r} to {tarball_path}", "debug", "updater")
            req = urllib.request.Request(tarball_url)
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(tarball_path, "wb") as f:
                    shutil.copyfileobj(resp, f)

            tarball_size = tarball_path.stat().st_size
            log(f"Tarball downloaded: {tarball_size} bytes", "debug", "updater")

            extract_path = tmp_path / "extracted"
            extract_path.mkdir()

            log(f"Extracting tarball to {extract_path}", "debug", "updater")
            with tarfile.open(tarball_path, "r:gz") as tar:
                tar.extractall(extract_path, filter="data")

            source_root = next(extract_path.iterdir())
            log(f"Extracted source root: {source_root}", "debug", "updater")

            with open(source_root / ".gitattributes", "w") as ga:
                ga.write("* text=auto\n")

            backend_source = source_root / "backend"
            frontend_source = source_root / "frontend"

            log(f"backend_source exists={backend_source.exists()} frontend_source exists={frontend_source.exists()}", "debug", "updater")

            if backend_source.exists():
                backend_target = compose_dir / "backend"
                log(f"Syncing backend: {backend_source} -> {backend_target}", "debug", "updater")
                _copy_update(backend_source, backend_target, preserved=BACKEND_PRESERVED)
                log("Backend sync complete", "debug", "updater")

            if frontend_source.exists():
                frontend_target = compose_dir / "frontend"
                log(f"Syncing frontend: {frontend_source} -> {frontend_target}", "debug", "updater")
                _copy_update(frontend_source, frontend_target, preserved=FRONTEND_PRESERVED)
                log("Frontend sync complete", "debug", "updater")

            if compose_dir.exists():
                log(f"Syncing compose root: {source_root} -> {compose_dir}", "debug", "updater")
                _copy_update(source_root, compose_dir, preserved=ROOT_PRESERVED)
                log("Compose root sync complete", "debug", "updater")

        requirements = compose_dir / "backend" / "requirements.txt"
        log(f"Checking for requirements.txt at {requirements}: exists={requirements.exists()}", "debug", "updater")
        if requirements.exists():
            log("Installing Python dependencies from requirements.txt", "debug", "updater")
            result = subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements)])
            log(f"pip install exited with code {result.returncode}", "debug", "updater")

        log("Backend and Frontend sync completed, restarting system", "success", "updater")

        _clear_cache()
        _hard_restart()
        return {"status": "restarting"}

    except Exception as e:
        log(f"Apply update failed: {e}", "error", "updater")
        return {"error": str(e)}

def _load_gitignore_file(path: Path) -> list[str]:
    gitignore_path = path / ".gitignore"
    log(f"Loading .gitignore from {gitignore_path}", "debug", "updater")

    patterns = []

    if not gitignore_path.exists():
        log(f"No .gitignore found at {gitignore_path}", "debug", "updater")
        return patterns

    try:
        for line in gitignore_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()

            if not line or line.startswith("#"):
                continue

            patterns.append(line.rstrip("/"))

        log(f"Loaded {len(patterns)} pattern(s) from {gitignore_path}", "debug", "updater")
    except Exception as e:
        log(f".gitignore parse failed: {e}", "error", "updater")

    return patterns


def _is_ignored(rel_path: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if fnmatch.fnmatch(rel_path, pattern) or rel_path.startswith(pattern):
            log(f"Path {rel_path!r} ignored by pattern {pattern!r}", "debug", "updater")
            return True
    return False

def _clear_cache():
    log("Clearing update cache (DELETE WHERE id=1)", "debug", "updater")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM update_cache WHERE id = 1")
            conn.commit()
        log("Update cache cleared", "debug", "updater")
    except Exception as e:
        log(f"Cache clear failed: {e}", "error", "updater")

def _copy_update(source: Path, dest: Path, inherited_patterns: list[str] | None = None, root: Path | None = None, preserved: set[str] | None = None, dest_inherited_patterns: list[str] | None = None, dest_root: Path | None = None):
    log(f"_copy_update: source={source} dest={dest}", "debug", "updater")
    dest.mkdir(parents=True, exist_ok=True)

    if root is None:
        root = source

    if dest_root is None:
        dest_root = dest

    if inherited_patterns is None:
        inherited_patterns = []

    if dest_inherited_patterns is None:
        dest_inherited_patterns = []

    local_gitignore = _load_gitignore_file(source)
    patterns = inherited_patterns + local_gitignore

    dest_local_gitignore = _load_gitignore_file(dest)
    dest_patterns = dest_inherited_patterns + dest_local_gitignore

    log(f"Active ignore patterns for {source.name!r}: {len(patterns)} source-side, {len(dest_patterns)} dest-side", "debug", "updater")

    items = list(source.iterdir())
    log(f"Found {len(items)} item(s) in {source}", "debug", "updater")

    for item in items:
        if item.is_symlink():
            log(f"Skipping symlink: {item.name!r}", "debug", "updater")
            continue

        if preserved and item.name in preserved:
            log(f"Skipping preserved item: {item.name!r}", "debug", "updater")
            continue

        rel = str(item.relative_to(root)).replace("\\", "/")

        if _is_ignored(rel, patterns):
            continue

        target = dest / item.name
        dest_rel = str(target.relative_to(dest_root)).replace("\\", "/")

        if _is_ignored(dest_rel, dest_patterns):
            continue

        if item.is_dir():
            log(f"Descending into directory: {item.name!r}", "debug", "updater")
            _copy_update(item, target, patterns, root, preserved, dest_patterns, dest_root)
        else:
            should_copy = True

            if target.exists():
                src_hash = _get_normalized_hash(item)
                dst_hash = _get_normalized_hash(target)
                if src_hash == dst_hash:
                    log(f"Skipping unchanged file: {item.name!r} (hash match)", "debug", "updater")
                    should_copy = False
                else:
                    log(f"File changed: {item.name!r} (src={src_hash[:8]} dst={dst_hash[:8]})", "debug", "updater")
            else:
                log(f"New file: {item.name!r}", "debug", "updater")

            if should_copy:
                _merge_or_copy(item, target, root)