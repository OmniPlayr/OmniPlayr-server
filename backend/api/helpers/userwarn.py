from api.helpers.log import log as _log

def user_warn(message: str) -> None:
    _log(message, "warning", "userwarn")