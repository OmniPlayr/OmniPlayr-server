import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import tomllib

from api.helpers.config import get_config
from api.helpers.log import log

PLUGIN_DIRS = {
    "backend": Path("/app/plugins"),
    "frontend": Path("/frontend/src/plugins"),
}

_PLUGIN_OVERWRITE_ALWAYS: set[str] = {
    "package.json",
}

_BACKEND_VERSION_FILES = (
    Path("/app/config.json"),
    Path("/compose/backend/config.local.json"),
    Path("config.local.json"),
    Path("config.json"),
)


def _ensure_plugin_root(plugin_type: str) -> bool:
    root = PLUGIN_DIRS.get(plugin_type)
    if root is None:
        log(f"Unknown plugin type from registry: {plugin_type!r}", "warning", "plugin_installer")
        return False

    try:
        root.mkdir(parents=True, exist_ok=True)
        return root.exists() and root.is_dir()
    except Exception as e:
        log(f"Plugin root unavailable for {plugin_type}: {root} ({e})", "warning", "plugin_installer")
        return False


def _normalize_constraint_key(key: str) -> str:
    return key.replace("-", "_").lower()


def _get_nested_value(data: dict, path: tuple[str, ...]):
    value = data
    for part in path:
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _get_constraint_value(info: dict, plugin_type: str, name: str) -> str | None:
    normalized_name = _normalize_constraint_key(name)
    candidates = [
        (plugin_type, normalized_name),
        (plugin_type, name),
        (plugin_type, f"{name}s"),
        (plugin_type, f"{normalized_name}s"),
        (f"{plugin_type}_{normalized_name}",),
        (f"{plugin_type}-{name}",),
        (f"{plugin_type}_{normalized_name}s",),
        (f"{plugin_type}-{name}s",),
        (name,),
        (normalized_name,),
        (f"{name}s",),
        (f"{normalized_name}s",),
        ("latest", plugin_type, normalized_name),
        ("latest", plugin_type, name),
    ]

    for path in candidates:
        value = _get_nested_value(info, path)
        if isinstance(value, str) and value.strip():
            return value.strip()

    for key, value in info.items():
        if (
            _normalize_constraint_key(key) in {f"{plugin_type}_{normalized_name}", normalized_name}
            and isinstance(value, str)
            and value.strip()
        ):
            return value.strip()

    return None


def _version_tuple(version: str | None) -> tuple[int, ...]:
    if not version:
        return (0,)
    base = version.split("-", 1)[0]
    parts: list[int] = []
    for raw in base.split("."):
        digits = "".join(ch for ch in raw if ch.isdigit())
        if digits == "":
            break
        parts.append(int(digits))
    return tuple(parts or [0])


def _compare_versions(left: str | None, right: str | None) -> int:
    left_parts = list(_version_tuple(left))
    right_parts = list(_version_tuple(right))
    length = max(len(left_parts), len(right_parts))
    left_parts.extend([0] * (length - len(left_parts)))
    right_parts.extend([0] * (length - len(right_parts)))

    if left_parts < right_parts:
        return -1
    if left_parts > right_parts:
        return 1
    return 0

def _current_version_info(plugin_type: str) -> dict:
    if plugin_type == "frontend":
        path = Path("/frontend/src/config/version.toml")
        if not path.exists():
            path = Path("frontend/src/config/version.toml")

        try:
            data = tomllib.loads(path.read_text("utf-8"))
            frontend = data.get("version", {}).get("frontend", {})
            safe_version = frontend.get("safeVersion") or "0.0.0"
            return {
                "safeVersion": safe_version,
                "version": safe_version,
                "branch": frontend.get("branch", "main"),
            }
        except Exception:
            return {"safeVersion": "0.0.0", "version": "0.0.0", "branch": "main"}
    else:
        for path in _BACKEND_VERSION_FILES:
            if not path.exists():
                continue
            data = None
            try:
                data = json.loads(path.read_text("utf-8"))
            except Exception:
                log(f"Could not read {path}", "warning", "plugin_installer")
                pass
            if data:
                return {
                    "safeVersion": data.get("safeVersion") or data.get("version") or "0.0.0",
                    "version": data.get("version") or data.get("safeVersion") or "0.0.0",
                    "branch": data.get("branch", "main"),
                }
        return {"safeVersion": "0.0.0", "version": "0.0.0", "branch": "main"}


def _check_version_constraints(info: dict, plugin_type: str) -> str | None:
    current = _current_version_info(plugin_type)
    current_version = str(current.get("safeVersion") or current.get("version") or "0.0.0")
    is_dev = current.get("branch") == "dev" or "dev" in current_version

    min_version = _get_constraint_value(info, plugin_type, "min-version")
    max_version = _get_constraint_value(info, plugin_type, "max-version")
    min_dev_version = _get_constraint_value(info, plugin_type, "min-dev-version")
    max_dev_version = _get_constraint_value(info, plugin_type, "max-dev-version")

    if min_version and _compare_versions(current_version, min_version) < 0:
        return f"{plugin_type} requires OmniPlayr {min_version} or newer. Current version is {current_version}."
    if max_version and _compare_versions(current_version, max_version) > 0:
        return f"{plugin_type} supports OmniPlayr up to {max_version}. Current version is {current_version}."
    if is_dev and min_dev_version and _compare_versions(current_version, min_dev_version) < 0:
        return f"{plugin_type} requires OmniPlayr dev version {min_dev_version} or newer. Current version is {current_version}."
    if is_dev and max_dev_version and _compare_versions(current_version, max_dev_version) > 0:
        return f"{plugin_type} supports OmniPlayr dev versions up to {max_dev_version}. Current version is {current_version}."

    return None


def _empty_env_example(source: Path, target: Path) -> None:
    output: list[str] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key = line.split("=", 1)[0].rstrip()
        output.append(f"{key}=")
    target.write_text("\n".join(output) + "\n", encoding="utf-8")
    log(f"Created empty plugin environment file: {target}", "info", "plugin_installer")


def fetch_plugin_info(package_id: str) -> dict | None:
    """Fetch plugin registry metadata for a package id."""
    registry_api = get_config("plugins.registry_api")
    url = f"{registry_api}?id={urllib.parse.quote(package_id)}"
    log(f"Fetching plugin info for {package_id}", "debug", "plugin_installer")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OmniPlayr-Installer/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
        log(f"Plugin info fetched ({len(raw)} bytes)", "debug", "plugin_installer")
        return json.loads(raw)
    except Exception as e:
        log(f"Failed to fetch plugin info: {e}", "error", "plugin_installer")
        return None


def _get_installed_version(install_dir: Path) -> str | None:
    pkg_path = install_dir / "package.json"
    if not pkg_path.exists():
        return None
    try:
        return json.loads(pkg_path.read_text("utf-8")).get("version")
    except Exception:
        return None


def _download_file(url: str, dest: Path) -> None:
    log(f"Downloading {url}", "debug", "plugin_installer")
    req = urllib.request.Request(url, headers={"User-Agent": "OmniPlayr-Installer/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status == 200:
            with open(dest, "wb") as f:
                shutil.copyfileobj(resp, f)
        else:
            raise RuntimeError(f"Download failed with status {resp.status}")


def _update_backend_config(plugin_id: str, version: str) -> None:
    config_path = Path("/compose/backend/config.local.json")
    if not config_path.exists():
        return

    try:
        config = json.loads(config_path.read_text("utf-8"))
    except Exception:
        return

    config.setdefault("plugins", {})[plugin_id] = f"^{version}"
    config_path.write_text(json.dumps(config, indent=4), "utf-8")
    log(f"Registered {plugin_id} v{version} in config.local.json", "info", "plugin_installer")

def _install_frontend_dependencies(install_dir: Path) -> None:
    pkg_path = install_dir / "package.json"
    if not pkg_path.exists():
        return

    try:
        plugin_pkg = json.loads(pkg_path.read_text("utf-8"))
    except Exception:
        return

    deps = plugin_pkg.get("dependencies", {})
    if not deps:
        return

    frontend_pkg_path = Path("/compose/frontend/package.json")
    if not frontend_pkg_path.exists():
        log("No frontend/package.json found, skipping dependency install", "warning", "plugin_installer")
        return

    try:
        frontend_pkg = json.loads(frontend_pkg_path.read_text("utf-8"))
    except Exception:
        log("Could not read frontend/package.json", "warning", "plugin_installer")
        return

    frontend_pkg.setdefault("dependencies", {})

    new_deps = [
        f"{name}@{ver}"
        for name, ver in deps.items()
        if name not in frontend_pkg["dependencies"]
    ]

    if not new_deps:
        return

    for dep in new_deps:
        name, ver = dep.rsplit("@", 1)
        frontend_pkg["dependencies"][name] = ver
        log(f"Added {dep} to frontend/package.json", "info", "plugin_installer")

    frontend_pkg_path.write_text(json.dumps(frontend_pkg, indent=2), "utf-8")

    log("Running npm install in frontend container...", "info", "plugin_installer")
    try:
        subprocess.run(
            ["docker", "exec", "omniplayr_frontend", "npm", "install"],
            check=True,
            capture_output=True,
        )
        log("Frontend dependencies installed", "info", "plugin_installer")
    except subprocess.CalledProcessError as e:
        log(f"npm install failed: {e.stderr.decode()}", "warning", "plugin_installer")


def _schedule_frontend_rebuild() -> bool:
    if os.environ.get("DEV_MODE", "").lower() == "true":
        log("Dev mode detected; frontend plugin will be picked up by Vite without rebuilding", "info", "plugin_installer")
        return False

    compose_dir = Path("/compose")
    if not compose_dir.exists():
        log("Compose directory not mounted; frontend rebuild skipped", "warning", "plugin_installer")
        return False

    try:
        subprocess.Popen(
            ["docker", "compose", "up", "-d", "--build", "frontend"],
            cwd=compose_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log("Scheduled frontend rebuild so installed frontend plugins are bundled", "info", "plugin_installer")
        return True
    except Exception as e:
        log(f"Could not schedule frontend rebuild: {e}", "warning", "plugin_installer")
        return False


def _is_in_config_dir(path: Path) -> bool:
    return any(part == "config" for part in path.parts)


def _is_config_types_file(path: Path) -> bool:
    stem = path.stem.lower()
    return "types" in stem or "config_types" in path.parts


def _is_mergeable_config(path: Path, root: Path) -> bool:
    if path.suffix not in (".toml", ".json"):
        return False
    if path.name in _PLUGIN_OVERWRITE_ALWAYS:
        return False
    if _is_config_types_file(path):
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


def _merge_toml_file(source: Path, dest: Path) -> None:
    log(f"Merging TOML config: source={source} dest={dest}", "debug", "plugin_installer")

    try:
        source_data = tomllib.loads(source.read_text(encoding="utf-8"))
        dest_data = tomllib.loads(dest.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"TOML merge parse failed for {dest}: {e}", "error", "plugin_installer")
        return

    to_add: dict[str | None, list[tuple]] = {}

    for key, value in source_data.items():
        if isinstance(value, dict):
            new_keys = {k: v for k, v in value.items() if k not in dest_data.get(key, {})}
            if new_keys:
                to_add[key] = list(new_keys.items())
        else:
            if key not in dest_data:
                to_add.setdefault(None, []).append((key, value))

    if not to_add:
        log(f"No new keys to add to {dest}, skipping write", "debug", "plugin_installer")
        return

    lines = dest.read_text(encoding="utf-8").splitlines(keepends=True)

    sections: list[tuple[str, int]] = []
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("[") and not s.startswith("[[") and "]" in s:
            sections.append((s[1:s.index("]")], i))

    insertions: dict[int, list[str]] = {}

    for i, (name, start) in enumerate(sections):
        if name not in to_add:
            continue
        end = sections[i + 1][1] if i + 1 < len(sections) else len(lines)
        new_lines = [f"{k} = {_toml_value(v)}\n" for k, v in to_add[name]]
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
        if result and result[-1].strip():
            result.append("\n")
        result.append(f"[{name}]\n")
        result.extend(f"{k} = {_toml_value(v)}\n" for k, v in kvs)

    if None in to_add:
        new_lines = [f"{k} = {_toml_value(v)}\n" for k, v in to_add[None]]
        first_section = next(
            (i for i, l in enumerate(result) if l.strip().startswith("[")),
            len(result),
        )
        result = result[:first_section] + new_lines + result[first_section:]

    dest.write_text("".join(result), encoding="utf-8")
    log(f"Merged config (TOML): {dest}", "info", "plugin_installer")


def _deep_merge_json(source: dict, dest: dict) -> dict:
    result = dict(dest)
    for key, value in source.items():
        if key not in result:
            result[key] = value
        elif isinstance(value, dict) and isinstance(result[key], dict):
            result[key] = _deep_merge_json(value, result[key])
    return result


def _merge_json_file(source: Path, dest: Path) -> None:
    log(f"Merging JSON config: source={source} dest={dest}", "debug", "plugin_installer")

    try:
        source_data = json.loads(source.read_text(encoding="utf-8"))
        dest_data = json.loads(dest.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"JSON merge parse failed for {dest}: {e}", "error", "plugin_installer")
        return

    if not isinstance(source_data, dict) or not isinstance(dest_data, dict):
        log(f"JSON merge skipped for {dest}: one or both files are not objects", "debug", "plugin_installer")
        return

    merged = _deep_merge_json(source_data, dest_data)

    if merged == dest_data:
        log(f"No new keys found in {source}, skipping write", "debug", "plugin_installer")
        return

    dest.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"Merged config (JSON): {dest}", "info", "plugin_installer")


def _merge_or_copy(source: Path, target: Path, root: Path) -> None:
    if target.exists() and target.is_dir():
        shutil.rmtree(target)
        log(f"Removed stale directory at file path: {target}", "warning", "plugin_installer")

    if target.exists() and _is_mergeable_config(source, root):
        if source.suffix == ".toml":
            _merge_toml_file(source, target)
        elif source.suffix == ".json":
            _merge_json_file(source, target)
        else:
            shutil.copy2(source, target)
            log(f"Updated: {target}", "info", "plugin_installer")
    else:
        shutil.copy2(source, target)
        log(f"Updated: {target}", "info", "plugin_installer")


def _install_files(source_dir: Path, install_dir: Path, root: Path | None = None) -> None:
    if root is None:
        root = source_dir

    install_dir.mkdir(parents=True, exist_ok=True)

    for item in source_dir.iterdir():
        if item.is_symlink():
            log(f"Skipping symlink: {item.name!r}", "debug", "plugin_installer")
            continue

        target = install_dir / item.name

        if item.is_dir():
            _install_files(item, target, root)
        else:
            _merge_or_copy(item, target, root)

    env_example = install_dir / ".env.example"
    env_file = install_dir / ".env"
    if env_example.exists() and not env_file.exists():
        _empty_env_example(env_example, env_file)


def install_plugin(package_id: str, version: str | None, target: str | None) -> dict:
    """Download and install a plugin from the configured registry."""
    info = fetch_plugin_info(package_id)
    if not info or info.get("error") or not info.get("package_id"):
        raise ValueError(f"Package not found: {package_id}")

    available_types = info.get("types", [])
    download_base = get_config("plugins.download_base")

    if target:
        if target not in PLUGIN_DIRS:
            raise ValueError(f"Unknown target '{target}'. Use 'backend' or 'frontend'.")
        if target not in available_types:
            raise ValueError(f"Plugin '{package_id}' does not have a {target} type.")
        if not _ensure_plugin_root(target):
            raise ValueError(f"Plugin directory for {target} is not available.")
        target_types = [target]
    else:
        target_types = [t for t in available_types if _ensure_plugin_root(t)]
        if not target_types:
            raise ValueError("No plugin directories found. Is this an OmniPlayr project?")

    results = []
    frontend_needs_rebuild = False

    for plugin_type in target_types:
        compatibility_error = _check_version_constraints(info, plugin_type)
        if compatibility_error:
            raise ValueError(compatibility_error)

        resolved_version = (
            version
            if version and version != "latest"
            else info.get("latest", {}).get(plugin_type)
        )

        if not resolved_version:
            log(f"No version available for {plugin_type}", "warning", "plugin_installer")
            results.append({"type": plugin_type, "status": "skipped", "reason": "no version available"})
            continue

        plugin_folder = package_id.replace("/", "_") if "@" in package_id else package_id
        install_dir = PLUGIN_DIRS[plugin_type] / plugin_folder

        installed_version = _get_installed_version(install_dir)
        if installed_version == resolved_version:
            log(f"{plugin_type} {package_id} v{resolved_version} already installed, skipping", "info", "plugin_installer")
            if plugin_type == "frontend":
                frontend_needs_rebuild = True
            results.append({"type": plugin_type, "status": "already_installed", "version": resolved_version})
            continue

        install_dir.mkdir(parents=True, exist_ok=True)

        download_url = (
            f"{download_base}"
            f"?id={urllib.parse.quote(package_id)}"
            f"&version={urllib.parse.quote(resolved_version)}"
            f"&type={urllib.parse.quote(plugin_type)}"
        )

        tmp_path = Path(tempfile.mktemp(suffix=".tar.gz"))
        try:
            _download_file(download_url, tmp_path)
            log(f"Downloaded {tmp_path.stat().st_size} bytes", "debug", "plugin_installer")
        except Exception as e:
            log(f"Download failed for {plugin_type}: {e}", "error", "plugin_installer")
            tmp_path.unlink(missing_ok=True)
            results.append({"type": plugin_type, "status": "failed", "reason": f"download failed: {e}"})
            continue

        tmp_extract = Path(tempfile.mkdtemp())
        try:
            with tarfile.open(tmp_path) as tf:
                tf.extractall(tmp_extract, filter="data")
        except Exception as e:
            log(f"Extraction failed: {e}", "error", "plugin_installer")
            tmp_path.unlink(missing_ok=True)
            shutil.rmtree(tmp_extract, ignore_errors=True)
            results.append({"type": plugin_type, "status": "failed", "reason": f"extraction failed: {e}"})
            continue

        tmp_path.unlink(missing_ok=True)

        type_dir = tmp_extract / plugin_type
        if type_dir.exists():
            _install_files(type_dir, install_dir)

        shutil.rmtree(tmp_extract, ignore_errors=True)

        if plugin_type == "backend":
            _update_backend_config(package_id, resolved_version)

        if plugin_type == "frontend":
            _install_frontend_dependencies(install_dir)
            frontend_needs_rebuild = True

        log(f"Installed {plugin_type} {package_id} v{resolved_version} to {install_dir}", "info", "plugin_installer")
        results.append({"type": plugin_type, "status": "installed", "version": resolved_version})

    frontend_rebuild_scheduled = _schedule_frontend_rebuild() if frontend_needs_rebuild else False

    return {
        "package_id": package_id,
        "results": results,
        "frontend_rebuild_scheduled": frontend_rebuild_scheduled,
    }
