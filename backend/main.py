import os
import uvicorn
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from api.helpers.db import init_db_when_ready
from api.router import router
from api.helpers.config import load_configs, get_config
from api.helpers.plugins import load_plugins, get_plugin_router, get_backend_plugin_reload_dirs
from api.helpers.config_watcher import start_config_watcher
from api.helpers.log import log, setup_exception_hook, setup_thread_exception_hook, setup_asyncio_exception_handler, log_exception
from api.helpers.fatal_error import clear_fatal_state, record_startup_exception
from api.helpers.notifications import notify_sync, set_main_loop
from api.helpers.account import list_accounts
from api.helpers.diagnostics import start_diagnostics
from api.helpers.health import router as health_router
from api.helpers.https_proxy import start_https_proxy
from api.helpers.updater import verify_startup_signature

import asyncio

# This makes sure any errors get logged into the log files
setup_exception_hook()
setup_thread_exception_hook()

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


def _reload_dirs() -> list[str]:
    """Return backend and resolved plugin directories watched in dev mode."""

    backend_dir = Path(__file__).resolve().parent
    candidates = [backend_dir / "api", backend_dir / "plugins"]
    candidates.extend(get_backend_plugin_reload_dirs(backend_dir / "config.local.json"))

    reload_dirs: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        resolved = str(candidate.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        reload_dirs.append(resolved)
    return reload_dirs


def _notify_admins():
    for account in list_accounts():
        if account["role"] != "admin":
            continue
        notify_sync(account["id"], "Power", "Server started", "The server has started successfully!")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        loop = asyncio.get_event_loop()
        set_main_loop(loop)
        setup_asyncio_exception_handler(loop)

        # This watches config.json and syncs new keys into config.local.json, so if you updated it will update the version and things.
        start_config_watcher()

        try:
            # This loads the config files
            load_configs()
        except Exception as exc:
            record_startup_exception("config", exc)
            log_exception(exc, "Fatal backend startup error: configuration failed", "main")
            raise

        try:
            startup_signature = verify_startup_signature()
            log(f"Startup signature verification status: {startup_signature.get('status')}", "info", "main")
        except Exception as exc:
            record_startup_exception("signature", exc)
            log_exception(exc, "Fatal backend startup error: update verification failed", "main")
            raise

        try:
            # This sets up the database, but needs to be after the configs are loaded, because the database also logs, and else you are going to get a lot of duplicate logs (I think)
            await init_db_when_ready()
        except Exception as exc:
            record_startup_exception("database", exc)
            log_exception(exc, "Fatal backend startup error: database failed", "main")
            raise

        try:
            # This loads the plugins
            if _is_safe_mode():
                log("Safe mode is active, plugins are disabled", "warning", "main")
            else:
                load_plugins()
        except Exception as exc:
            record_startup_exception("plugins", exc)
            log_exception(exc, "Fatal backend startup error: plugin loading failed", "main")
            raise

        # This sets the /api/plugin prefix for plugins
        app.include_router(get_plugin_router(), prefix="/api/plugin")

        try:
            start_diagnostics(get_config('diagnostics.interval_seconds', 600))
        except Exception as exc:
            record_startup_exception("diagnostics", exc)
            log_exception(exc, "Fatal backend startup error: diagnostics failed", "main")
            raise

        try:
            start_https_proxy()
        except Exception as exc:
            record_startup_exception("proxy", exc)
            log_exception(exc, "Fatal backend startup error: HTTPS proxy failed", "main")
            raise

        clear_fatal_state()
        log("Server started", "info", "main")

        # This sends a notification to admins that the server has started and that the update has been applied
        asyncio.get_running_loop().create_task(_delayed_startup_notifications())
    except Exception as exc:
        if not os.path.exists("logs/backend-fatal.json"):
            record_startup_exception("unknown", exc)
            log_exception(exc, "Fatal backend startup error", "main")
        raise
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

# This handles errors for the API and sends them to the log
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log_exception(exc, f"Unhandled error on {request.method} {request.url.path}")
    headers = {}
    origin = request.headers.get("origin")
    if origin:
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )

# This sets the /api prefix for in the url, so that we can use /api/...
app.include_router(router, prefix="/api")
app.include_router(health_router, prefix="/api")
if __name__ == "__main__":
    dev_mode = os.environ.get("DEV_MODE", "").lower() == "true"
    reload_dirs = _reload_dirs() if dev_mode else None
    if reload_dirs:
        log(f"Backend hot reload is watching: {reload_dirs}", "info", "main")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8226,
        reload=dev_mode,
        reload_dirs=reload_dirs,
    )
