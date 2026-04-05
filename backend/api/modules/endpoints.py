from fastapi import APIRouter, Request

router = APIRouter()

@router.get("/")
def list_endpoints(request: Request):
    routes = []
    for route in request.app.routes:
        if not hasattr(route, "methods"):
            continue
        routes.append({
            "path": route.path,
            "methods": list(route.methods),
            "name": route.name,
        })
    return routes