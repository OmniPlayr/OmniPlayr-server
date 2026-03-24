from fastapi import APIRouter
from api.modules.account import router as account_router
from api.modules.setup import router as setup_router

router = APIRouter()
router.include_router(account_router, prefix="/accounts", tags=["accounts"])
router.include_router(setup_router, prefix="/setup", tags=["setup"])