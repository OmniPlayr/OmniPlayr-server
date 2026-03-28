# This is currently just a way to print something, but will be expanded later to a real working log
def log(message: str, level: str = "info") -> None:
    print(f"[{level.upper()}] {message}", flush=True)