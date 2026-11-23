from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from api.helpers.log import log
from api.helpers.plugin_db import clear_plugin_data as clear_plugin_database
from api.helpers.plugin_db import delete_plugin_data as delete_plugin_database
from api.helpers.plugin_installer import PLUGIN_DIRS, _schedule_frontend_rebuild

_CONFIG_PATHS = (
    Path("/compose/backend/config.local.json"),
    Path("config.local.json"),
    Path("config.json"),
)


def _plugin_relative_path(package_id: str) -> Path:
    if not isinstance(package_id, str) or not package_id.strip():
        raise ValueError("A valid package_id is required")

    folder = package_id.replace("/", "_") if "@" in package_id else package_id
    if "\\" in folder or "\x00" in folder:
        raise ValueError("Invalid package_id")

    parts = folder.split("/")
    if not folder or folder.startswith("/") or any(part in ("", ".", "..") for part in parts):
        raise ValueError("Invalid package_id")

    relative = Path(folder)
    if relative.is_absolute():
        raise ValueError("Invalid package_id")

    return relative


def _plugin_directory(plugin_type: str, package_id: str) -> Path:
    root = PLUGIN_DIRS.get(plugin_type)
    if root is None:
        raise ValueError(f"Unknown plugin type: {plugin_type}")

    relative = _plugin_relative_path(package_id)
    root_resolved = root.resolve()
    candidate = root / relative
    candidate_resolved = candidate.resolve(strict=False)

    try:
        candidate_resolved.relative_to(root_resolved)
    except ValueError as e:
        raise ValueError("Plugin path resolves outside its plugin directory") from e

    return candidate


def _remove_plugin_directory(path: Path, root: Path) -> bool:
    if path.is_symlink():
        path.unlink()
        removed = True
    elif path.is_dir():
        shutil.rmtree(path)
        removed = True
    elif path.exists():
        path.unlink()
        removed = True
    else:
        removed = False

    if removed:
        root_resolved = root.resolve()
        parent = path.parent
        while parent != root and parent.exists():
            try:
                parent.resolve().relative_to(root_resolved)
            except ValueError:
                break
            try:
                next(parent.iterdir())
                break
            except StopIteration:
                parent.rmdir()
                parent = parent.parent

    return removed


def _remove_backend_config_entry(package_id: str) -> dict[str, Any]:
    updated: list[str] = []
    warnings: list[str] = []
    seen: set[str] = set()

    for path in _CONFIG_PATHS:
        if not path.exists():
            continue

        resolved_key = str(path.resolve())
        if resolved_key in seen:
            continue
        seen.add(resolved_key)

        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            warning = f"Could not read {path}: {e}"
            warnings.append(warning)
            log(warning, "warning", "plugin_installer")
            continue

        if not isinstance(config, dict):
            continue

        plugins = config.get("plugins")
        changed = False

        if isinstance(plugins, dict) and package_id in plugins:
            plugins.pop(package_id, None)
            changed = True
        elif isinstance(plugins, list) and package_id in plugins:
            config["plugins"] = [item for item in plugins if item != package_id]
            changed = True

        if not changed:
            continue

        temp_path = path.with_name(f"{path.name}.tmp")
        try:
            temp_path.write_text(json.dumps(config, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
            temp_path.replace(path)
            updated.append(str(path))
            log(f"Removed {package_id!r} from {path}", "info", "plugin_installer")
        except Exception as e:
            warning = f"Could not update {path}: {e}"
            warnings.append(warning)
            log(warning, "error", "plugin_installer")
            temp_path.unlink(missing_ok=True)

    return {"updated": updated, "warnings": warnings}


def remove_installed_plugin(
    package_id: str,
    target: str | None = None,
    delete_data: bool = False,
) -> dict[str, Any]:
    if target is not None and target not in PLUGIN_DIRS:
        raise ValueError("Invalid target, must be 'backend' or 'frontend'")
    if target == "frontend" and delete_data:
        raise ValueError("Database data can only be removed when target is 'backend' or omitted")

    targets = [target] if target else ["backend", "frontend"]
    results: list[dict[str, Any]] = []
    frontend_files_removed = False
    backend_restart_required = False

    for plugin_type in targets:
        root = PLUGIN_DIRS[plugin_type]
        plugin_dir = _plugin_directory(plugin_type, package_id)
        database_tables: list[str] = []
        config_result: dict[str, Any] = {"updated": [], "warnings": []}

        if plugin_type == "backend":
            backend_restart_required = True
            if delete_data:
                try:
                    database_tables = delete_plugin_database(package_id)
                except Exception as e:
                    log(f"Failed to delete database data for {package_id}: {e}", "error", "plugin_installer")
                    results.append({
                        "type": plugin_type,
                        "status": "failed",
                        "reason": f"database cleanup failed: {e}",
                        "files_removed": False,
                    })
                    continue
                config_result = _remove_backend_config_entry(package_id)

        try:
            files_removed = _remove_plugin_directory(plugin_dir, root)
        except Exception as e:
            log(f"Failed to remove {plugin_type} plugin files for {package_id}: {e}", "error", "plugin_installer")
            results.append({
                "type": plugin_type,
                "status": "failed",
                "reason": f"file removal failed: {e}",
                "files_removed": False,
                "database_tables_removed": database_tables,
                "config_files_updated": config_result["updated"],
                "warnings": config_result["warnings"],
            })
            continue

        if plugin_type == "frontend" and files_removed:
            frontend_files_removed = True

        results.append({
            "type": plugin_type,
            "status": "removed" if files_removed else "not_installed",
            "files_removed": files_removed,
            "database_tables_removed": database_tables,
            "config_files_updated": config_result["updated"],
            "warnings": config_result["warnings"],
        })

        log(
            f"Plugin removal: type={plugin_type} package_id={package_id!r} "
            f"files_removed={files_removed} delete_data={delete_data}",
            "info",
            "plugin_installer",
        )

    frontend_rebuild_scheduled = _schedule_frontend_rebuild() if frontend_files_removed else False

    return {
        "package_id": package_id,
        "delete_data": delete_data,
        "results": results,
        "frontend_rebuild_scheduled": frontend_rebuild_scheduled,
        "backend_restart_required": backend_restart_required,
    }


def clear_installed_plugin_data(package_id: str) -> dict[str, Any]:
    tables = clear_plugin_database(package_id)
    return {
        "package_id": package_id,
        "tables_cleared": tables,
        "table_count": len(tables),
    }
