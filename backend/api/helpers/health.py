import os
import re
import subprocess
from fastapi import APIRouter
from pydantic import BaseModel
import socket

from api.helpers.diagnostics import get_error_counts, get_uptime_seconds
from api.helpers.log import log

router = APIRouter()

_EXITED_OK_RE = re.compile(r"exited\s*\(0\)", re.IGNORECASE)


class ServiceStatus(BaseModel):
    name: str
    id: str
    status: str
    running: bool
    healthy: bool


class HealthResponse(BaseModel):
    status: str
    uptime_seconds: float
    minor_health_error: int
    normal_health_error: int
    critical_health_error: int
    services: list[ServiceStatus]


def _is_healthy_status(status: str) -> bool:
    if status.lower().startswith("up"):
        return True
    if _EXITED_OK_RE.search(status):
        return True
    return False


def _get_compose_project() -> str:
    try:
        hostname = socket.gethostname()
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{index .Config.Labels \"com.docker.compose.project\"}}", hostname],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip().lower() if result.returncode == 0 else ""
    except Exception:
        return ""


def _get_docker_services() -> list[ServiceStatus]:
    project = os.environ.get("COMPOSE_PROJECT_NAME", "").lower() or _get_compose_project()

    try:
        cmd = ["docker", "ps", "-a", "--format", "{{.Names}}\t{{.ID}}\t{{.Status}}"]
        if project:
            cmd += ["--filter", f"label=com.docker.compose.project={project}"]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if result.returncode != 0:
            return []

        services: list[ServiceStatus] = []
        for line in result.stdout.strip().splitlines():
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            name, container_id, status = parts[0], parts[1], parts[2]

            if "backend-init" in name.lower():
                continue

            running = status.lower().startswith("up")
            healthy = _is_healthy_status(status)
            services.append(ServiceStatus(
                name=name,
                id=container_id,
                status=status,
                running=running,
                healthy=healthy,
            ))
        return services

    except FileNotFoundError:
        return []
    except subprocess.TimeoutExpired:
        log("Docker service check timed out", "diag")
        return []
    except Exception as e:
        log(f"Docker service check failed: {e}", "error")
        return []


def _overall_status(counts: dict, services: list[ServiceStatus]) -> str:
    has_unhealthy_service = any(not s.healthy for s in services)
    if counts["critical"] > 0 or has_unhealthy_service:
        return "critical"
    if counts["normal"] > 0:
        return "degraded"
    if counts["minor"] > 0:
        return "warning"
    return "healthy"


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    counts = get_error_counts()
    services = _get_docker_services()
    status = _overall_status(counts, services)

    return HealthResponse(
        status=status,
        uptime_seconds=round(get_uptime_seconds(), 1),
        minor_health_error=counts["minor"],
        normal_health_error=counts["normal"],
        critical_health_error=counts["critical"],
        services=services,
    )