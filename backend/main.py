import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.helpers.db import init_db
from api.router import router
from api.helpers.config import load_configs
from api.helpers.plugins import load_plugins

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # This loads the config files
    load_configs()
    
    # This loads the plugins
    load_plugins()
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
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)