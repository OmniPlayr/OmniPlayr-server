from fastapi import APIRouter
from api.modules.account import router as account_router
from api.modules.setup import router as setup_router
from api.modules.server import router as server_router
from api.modules.player import router as player_router
from api.modules.endpoints import router as endpoints_router
from api.modules.logs import router as logs_router
from api.modules.system import router as system_router
from api.helpers.omniplayr import get_plugin_router
from api.modules.server_info import router as server_info

router = APIRouter()
router.include_router(account_router, prefix="/accounts", tags=["accounts"])
router.include_router(setup_router, prefix="/setup", tags=["setup"])
router.include_router(server_router, prefix="/server", tags=["server"])
router.include_router(player_router, prefix="/player", tags=["player"])
router.include_router(endpoints_router, prefix="/endpoints", tags=["endpoints"])
router.include_router(get_plugin_router(), prefix="/plugins", tags=["plugins"])
router.include_router(server_info, prefix="/info", tags=["info"])
router.include_router(logs_router, prefix="/logs", tags=["logs"])
router.include_router(system_router, prefix="/system", tags=["system"])