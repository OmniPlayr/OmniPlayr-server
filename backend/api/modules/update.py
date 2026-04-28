from fastapi import APIRouter, Depends, Query
from api.helpers.admin import verify_admin
from api.helpers.updater import check_for_updates, apply_update

router = APIRouter()


@router.get("/check")
def check_update(
    force: bool = Query(default=False, description="Bypass cache and fetch from GitHub immediately"),
    admin=Depends(verify_admin),
):
    return check_for_updates(force=force)


@router.post("/apply")
def apply_available_update(admin=Depends(verify_admin)):
    return apply_update()