from fastapi import APIRouter
from pathlib import Path
import json

router = APIRouter()

config_file = Path("config.local.json")

@router.get("/server")
def get_setup_state():
    with open(config_file, "r") as f:
        return json.load(f)

    return {'error': 'Config file not found'}