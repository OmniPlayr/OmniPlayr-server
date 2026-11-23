from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.helpers.admin import verify_admin
from api.helpers.log import log
from api.helpers.plugin_installer import install_plugin
from api.helpers.plugin_removal import clear_installed_plugin_data, remove_installed_plugin

router = APIRouter()


@router.post("/install")
def install_plugin_route(
    package_id: str,
    target: Optional[str] = None,
    version: Optional[str] = None,
    admin=Depends(verify_admin),
):
    if not package_id:
        raise HTTPException(status_code=400, detail="Missing required parameter 'package_id'")

    if target and target not in ("frontend", "backend"):
        raise HTTPException(status_code=400, detail="Invalid target, must be 'frontend' or 'backend'")

    log(f"Install requested: {package_id} version={version!r} target={target!r}", "info", "plugins")

    try:
        result = install_plugin(package_id, version, target)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log(f"Plugin install error: {e}", "error", "plugins")
        raise HTTPException(status_code=500, detail="Internal error during plugin installation")


@router.delete("/remove")
def remove_plugin_route(
    package_id: str,
    target: Optional[str] = None,
    delete_data: bool = False,
    admin=Depends(verify_admin),
):
    if not package_id:
        raise HTTPException(status_code=400, detail="Missing required parameter 'package_id'")

    if target and target not in ("frontend", "backend"):
        raise HTTPException(status_code=400, detail="Invalid target, must be 'frontend' or 'backend'")

    log(
        f"Plugin removal requested: {package_id} target={target!r} delete_data={delete_data}",
        "info",
        "plugins",
    )

    try:
        return remove_installed_plugin(package_id, target, delete_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log(f"Plugin removal error: {e}", "error", "plugins")
        raise HTTPException(status_code=500, detail="Internal error during plugin removal")


@router.delete("/clear-data")
def clear_plugin_data_route(
    package_id: str,
    admin=Depends(verify_admin),
):
    if not package_id:
        raise HTTPException(status_code=400, detail="Missing required parameter 'package_id'")

    log(f"Plugin data clear requested: {package_id}", "info", "plugins")

    try:
        return clear_installed_plugin_data(package_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log(f"Plugin data clear error for {package_id}: {e}", "error", "plugins")
        raise HTTPException(status_code=500, detail="Internal error while clearing plugin data")
