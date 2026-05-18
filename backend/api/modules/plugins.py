from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from api.helpers.log import log

router = APIRouter()