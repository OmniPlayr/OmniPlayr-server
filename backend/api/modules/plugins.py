from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.helpers.admin import verify_admin
from api.helpers.log import log
from api.helpers.plugin_installer import install_local_plugin, install_plugin

router = APIRouter()

# This is to install plugins from the registry without using the cli
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


@router.post("/install-local")
def install_local_plugin_route(
    path: str,
    target: str,
    package_id: Optional[str] = None,
    mode: str = "link",
    admin=Depends(verify_admin),
):
    if not path:
        raise HTTPException(status_code=400, detail="Missing required parameter 'path'")

    if target not in ("frontend", "backend"):
        raise HTTPException(status_code=400, detail="Invalid target, must be 'frontend' or 'backend'")

    log(f"Local install requested: path={path!r} target={target!r} package_id={package_id!r} mode={mode!r}", "info", "plugins")

    try:
        return install_local_plugin(path, target, package_id, mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log(f"Local plugin install error: {e}", "error", "plugins")
        raise HTTPException(status_code=500, detail="Internal error during local plugin installation")
