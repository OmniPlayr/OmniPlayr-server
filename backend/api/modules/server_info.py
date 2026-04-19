from fastapi import APIRouter
from pathlib import Path
import json
import os

router = APIRouter()

config_file = Path("config.local.json")

@router.get("/server")
def get_setup_state():
    with open(config_file, "r") as f:
        return json.load(f)
    return {'error': 'Config file not found'}

@router.get("/safe-mode")
def get_safe_mode_status():
    return {"safe_mode": os.path.exists(".safe_mode")}