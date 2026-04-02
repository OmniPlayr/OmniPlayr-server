from fastapi import APIRouter, Request, HTTPException, Body
from pydantic import BaseModel

router = APIRouter()

_loaded_sources = {}

class MediaSource(BaseModel):
    source_type: str
    song_id: int

@router.get("/media/{source_type}:{song_id}")
def get_song(source: MediaSource, request: Request):
    return