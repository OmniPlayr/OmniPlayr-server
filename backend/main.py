import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from api.helpers.db import init_db
from api.router import router
from api.helpers.config import load_configs, get_config
from api.helpers.plugins import load_plugins, get_plugin_router
from api.helpers.config_watcher import start_config_watcher
from api.helpers.log import log
from api.helpers.notifications import notify_sync, set_main_loop
from api.helpers.account import list_accounts
from api.helpers.diagnostics import start_diagnostics
from api.helpers.health import router as health_router
from api.helpers.https_proxy import start_https_proxy

import asyncio

_SAFE_MODE_FILE = ".safe_mode"
_UPDATE_MARKER = ".update_applied"


def _notify_admins_update():
    if not os.path.exists(_UPDATE_MARKER):
        return
    try:
        os.remove(_UPDATE_MARKER)
    except Exception:
        pass
    for account in list_accounts():
        if account["role"] != "admin":
            continue
        notify_sync(
            account["id"],
            "RefreshCw",
            "Update applied successfully",
            "The server has been updated and restarted successfully.",
            action_type="internal",
            action_url="/settings/about",
        )


def _is_safe_mode() -> bool:
    return os.path.exists(_SAFE_MODE_FILE)


def _notify_admins():
    for account in list_accounts():
        if account["role"] != "admin":
            continue
        notify_sync(account["id"], "Power", "Server started", "The server has started successfully!")


@asynccontextmanager
async def lifespan(app: FastAPI):
    set_main_loop(asyncio.get_event_loop())

    # This watches config.json and syncs new keys into config.local.json, so if you updated it will update the version and things.
    start_config_watcher()

    # This loads the config files
    load_configs()

    # This sets up the database, but needs to be after the configs are loaded, because the database also logs, and else you are going to get a lot of duplicate logs (I think)
    init_db()
    # This loads the plugins
    if _is_safe_mode():
        log("Safe mode is active, plugins are disabled", "warning", "main")
    else:
        load_plugins()

    # This sets the /api/plugin prefix for plugins
    app.include_router(get_plugin_router(), prefix="/api/plugin")

    start_diagnostics(get_config('diagnostics.interval_seconds', 600))

    start_https_proxy()

    log("Server started", "info", "main")

    # This sends a notification to admins that the server has started and that the update has been applied
    asyncio.get_running_loop().create_task(_delayed_startup_notifications())
    yield


async def _delayed_startup_notifications():
    await asyncio.sleep(5)
    _notify_admins()
    _notify_admins_update()


app = FastAPI(title="OmniPlayr API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# This sets the /api prefix for in the url, so that we can use /api/...
app.include_router(router, prefix="/api")
app.include_router(health_router, prefix="/api")

if __name__ == "__main__":
    dev_mode = os.environ.get("DEV_MODE", "").lower() == "true"
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8226,
        reload=dev_mode,
        reload_dirs=["/app/api"] if dev_mode else None,
    )