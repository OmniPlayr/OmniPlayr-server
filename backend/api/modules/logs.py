from fastapi import APIRouter, Depends, Query
from api.helpers.log import get_logs
from api.helpers.admin import verify_admin

router = APIRouter()

# This is to get the logs and read them
@router.get("/")
def read_logs(
    hours: int = Query(default=24, ge=1, le=720),
    limit: int = Query(default=200, ge=1, le=1000),
    before: str | None = Query(default=None),
    since: str | None = Query(default=None),
    admin=Depends(verify_admin),
):
    return get_logs(since_hours=hours, limit=limit, before=before, since=since)