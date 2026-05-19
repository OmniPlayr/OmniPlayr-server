import json
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from api.helpers.config import get_config
from api.helpers.log import log

PLUGIN_DIRS = {
    "backend": Path("/app/plugins"),
    "frontend": Path("/frontend/src/plugins"),
}


def fetch_plugin_info(package_id: str) -> dict | None:
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
        result = subprocess.run(
            ["docker", "exec", "omniplayr_frontend", "npm", "install"],
            check=True,
            capture_output=True,
        )
        log("Frontend dependencies installed", "info", "plugin_installer")
    except subprocess.CalledProcessError as e:
        log(f"npm install failed: {e.stderr.decode()}", "warning", "plugin_installer")


def install_plugin(package_id: str, version: str | None, target: str | None) -> dict:
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
        target_types = [target]
    else:
        target_types = [t for t in available_types if PLUGIN_DIRS[t].exists()]
        if not target_types:
            raise ValueError("No plugin directories found. Is this an OmniPlayr project?")

    results = []

    for plugin_type in target_types:
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
            for item in type_dir.iterdir():
                dest = install_dir / item.name
                if item.is_dir():
                    shutil.copytree(item, dest, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, dest)

        shutil.rmtree(tmp_extract, ignore_errors=True)

        if plugin_type == "backend":
            _update_backend_config(package_id, resolved_version)

        if plugin_type == "frontend":
            _install_frontend_dependencies(install_dir)

        log(f"Installed {plugin_type} {package_id} v{resolved_version} to {install_dir}", "info", "plugin_installer")
        results.append({"type": plugin_type, "status": "installed", "version": resolved_version})

    return {"package_id": package_id, "results": results}