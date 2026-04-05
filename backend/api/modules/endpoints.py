from fastapi import APIRouter, Request

router = APIRouter()

@router.get("/")
def list_endpoints(request: Request):
    routes = []
    seen_names = set()
    for route in request.app.routes:
        if not hasattr(route, "methods"):
            continue
        path = route.path
        if path.startswith("/api/plugins/"):
            path = "/api/plugin/" + path[len("/api/plugins/"):]
        if route.name in seen_names:
            continue
        seen_names.add(route.name)
        routes.append({
            "path": path,
            "methods": list(route.methods),
            "name": route.name,
        })
    return routes