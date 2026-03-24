import asyncio, sys
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import asyncio
import websockets
import json
import os
import threading
import http.server
import socketserver
import webbrowser
import time
import subprocess

SETUP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SETUP_DIR)

connected_clients: set = set()
log_history: list = []

pending_questions: dict = {}

async def broadcast(message: dict):
    payload = json.dumps(message)
    log_history.append(payload)
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send(payload)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)

async def log(text: str, level: str = "info"):
    print(f"[{level.upper()}] {text}", flush=True)
    await broadcast({"type": "log", "level": level, "text": text})

async def set_stage(stage: str, label: str):
    await broadcast({"type": "stage", "stage": stage, "label": label})

async def set_progress(pct: int):
    await broadcast({"type": "progress", "pct": pct})

async def ask(question_id: str, question: str, options: list) -> str:
    """Send a question to the UI and wait for the user's answer."""
    loop = asyncio.get_event_loop()
    fut = loop.create_future()
    pending_questions[question_id] = fut
    await broadcast({
        "type": "question",
        "id": question_id,
        "text": question,
        "options": options,
    })
    answer = await fut
    del pending_questions[question_id]
    return answer

async def run_cmd(args: list) -> bool:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=PROJECT_DIR,
    )
    async for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace").rstrip()
        if line:
            await log(line)
    await proc.wait()
    return proc.returncode == 0


def _images_exist() -> bool:
    """Return True if docker compose images are already built."""
    try:
        result = subprocess.run(
            ["docker", "compose", "images", "--format", "json"],
            capture_output=True,
            cwd=PROJECT_DIR,
            timeout=10,
        )
        output = result.stdout.decode().strip()
        if result.returncode == 0 and output and output != "[]":
            return True
        result2 = subprocess.run(
            ["docker", "compose", "images"],
            capture_output=True,
            cwd=PROJECT_DIR,
            timeout=10,
        )
        lines = result2.stdout.decode().strip().splitlines()
        return len(lines) > 1
    except Exception:
        return False


async def run_install(force_rebuild: bool = False):
    await asyncio.sleep(1.0)

    if force_rebuild:
        await set_stage("pulling", "Pulling Docker images...")
        await set_progress(5)
        await log("Pulling required Docker images - this may take a few minutes on first run...", "info")
        ok = await run_cmd(["docker", "compose", "pull", "--ignore-pull-failures"])
        if not ok:
            await log("docker compose pull returned non-zero - continuing anyway", "warn")

        await set_progress(30)
        await set_stage("building", "Building service images...")
        await log("Building frontend and backend images...", "info")
        ok = await run_cmd(["docker", "compose", "build", "--no-cache", "--progress=plain"])
        if not ok:
            await log("Build step failed. Check the logs above.", "error")
            await set_stage("error", "Build failed")
            return
    else:
        await set_stage("building", "Using existing images...")
        await set_progress(30)
        await log("Skipping build - using existing Docker images.", "info")

    await set_progress(65)
    await set_stage("starting", "Starting services...")
    await log("Starting database...", "info")

    ok = await run_cmd(["docker", "compose", "up", "-d", "db"])
    if not ok:
        await log("Failed to start database container.", "error")
        await set_stage("error", "DB start failed")
        return

    await log("Waiting for Postgres to be ready...", "info")
    for attempt in range(20):
        check = await asyncio.create_subprocess_exec(
            "docker", "compose", "exec", "-T", "db", "pg_isready", "-U", "postgres",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=PROJECT_DIR,
        )
        await check.wait()
        if check.returncode == 0:
            await log("Database is ready.", "success")
            break
        await log(f"Postgres not ready yet (attempt {attempt + 1}/20)...", "info")
        await asyncio.sleep(2)
    else:
        await log("Postgres did not become ready in time.", "error")
        await set_stage("error", "DB not ready")
        return

    await set_progress(80)
    await log("Starting backend...", "info")
    ok = await run_cmd(["docker", "compose", "up", "-d", "backend"])
    if not ok:
        await log("Failed to start backend container.", "error")
        await set_stage("error", "Backend start failed")
        return

    await set_progress(90)
    await log("Starting frontend...", "info")
    ok = await run_cmd(["docker", "compose", "up", "-d", "frontend"])
    if not ok:
        await log("Failed to start frontend container.", "error")
        await set_stage("error", "Frontend start failed")
        return

    await set_progress(100)
    await set_stage("done", "Setup complete")
    await log("All services are up. OmniPlayr is ready!", "success")
    await broadcast({"type": "next", "step": 1})


async def startup_sequence():
    """Decide whether to build or skip, then run install."""
    await asyncio.sleep(1.5)

    images_exist = _images_exist()

    if images_exist:
        await log("Existing Docker build detected.", "info")
        answer = await ask(
            "rebuild_prompt",
            "An existing build was found. What would you like to do?",
            [
                {"value": "start",   "label": "Start existing build"},
                {"value": "rebuild", "label": "Force rebuild from scratch"},
            ],
        )
        force_rebuild = (answer == "rebuild")
    else:
        await log("No existing build found - starting fresh build.", "info")
        force_rebuild = True

    await run_install(force_rebuild=force_rebuild)


async def ws_handler(websocket):
    connected_clients.add(websocket)
    try:
        for msg in log_history:
            await websocket.send(msg)

        async for raw_msg in websocket:
            try:
                msg = json.loads(raw_msg)
            except Exception:
                continue
            if msg.get("type") == "answer":
                qid = msg.get("id")
                value = msg.get("value")
                if qid in pending_questions and not pending_questions[qid].done():
                    pending_questions[qid].set_result(value)
    finally:
        connected_clients.discard(websocket)


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SETUP_DIR, **kwargs)

    def log_message(self, *args):
        pass


def serve_http():
    with socketserver.TCPServer(("0.0.0.0", 8080), StaticHandler) as httpd:
        httpd.serve_forever()


async def main():
    threading.Thread(target=serve_http, daemon=True).start()
    print("Setup UI available at http://localhost:8080", flush=True)

    time.sleep(0.5)
    try:
        webbrowser.open("http://localhost:8080")
    except Exception:
        pass

    install_task = asyncio.create_task(startup_sequence())

    async with websockets.serve(ws_handler, "0.0.0.0", 8765):
        await install_task
        await asyncio.Event().wait()


asyncio.run(main())