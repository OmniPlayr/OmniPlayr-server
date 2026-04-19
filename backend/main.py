import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
 
from api.helpers.db import init_db
from api.router import router
from api.helpers.config import load_configs
from api.helpers.omniplayr import load_plugins, get_plugin_router
from api.helpers.config_watcher import start_config_watcher
from api.helpers.log import log
 
_SAFE_MODE_FILE = ".safe_mode"

def _is_safe_mode() -> bool:
    return os.path.exists(_SAFE_MODE_FILE)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # This loads the config files
    load_configs()

    # This watches config.json and syncs new keys into config.local.json, so if you updated it will update the version and things.
    start_config_watcher()
    
    # This loads the plugins
    if _is_safe_mode():
        log("Safe mode is active - plugins are disabled", "warning", "main")
    else:
        load_plugins()

    # This sets the /api/plugin prefix for plugins
    app.include_router(get_plugin_router(), prefix="/api/plugin")
    yield


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

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8224, reload=False)