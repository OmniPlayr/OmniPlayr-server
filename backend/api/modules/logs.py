from fastapi import APIRouter, Depends, Query
from api.helpers.log import get_logs
from api.helpers.admin import verify_admin

router = APIRouter()


@router.get("/")
def read_logs(
    hours: int = Query(default=24, ge=1, le=720),
    admin=Depends(verify_admin),
):
    return get_logs(since_hours=hours)