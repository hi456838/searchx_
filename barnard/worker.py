"""Run one worker process with a persistent BARNARD_CACHE_DIR."""
import json
import logging
import os
from pathlib import Path
from threading import Lock, Thread

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from pipeline import InsufficientData, render

app = FastAPI()
cache = Path(os.environ.get("BARNARD_CACHE_DIR", "./barnard-cache")) / "neowise-w1-v1"
manifest_file = cache / "manifest.json"
lock = Lock()
state = {"status": "idle"}
JOB_ID = "barnard-neowise-w1-v1"


def update(status, message=None):
    with lock:
        state.update(status=status, message=message)


def build():
    try:
        cache.mkdir(parents=True, exist_ok=True)
        manifest = render(cache, lambda message: update("running", message))
        temporary = manifest_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest), encoding="utf-8")
        temporary.replace(manifest_file)
        update("ready")
    except InsufficientData:
        update("insufficient", "IRSA returned fewer than two usable observation dates.")
    except Exception:
        logging.exception("Barnard's Star image processing failed")
        update("error", "Could not prepare the IRSA observations. Try again.")


def snapshot():
    if manifest_file.is_file():
        return JSONResponse({"status": "ready", "manifest": json.loads(manifest_file.read_text(encoding="utf-8"))})
    result = {**state, "jobId": JOB_ID}
    return JSONResponse(result, status_code=202 if state["status"] == "running" else 200)


@app.post("/sequence")
def start():
    with lock:
        if not manifest_file.is_file() and state["status"] not in ("running", "insufficient"):
            state.update(status="running", message="Finding NEOWISE W1 observations at IRSA.")
            Thread(target=build, daemon=True).start()
        return snapshot()


@app.get("/sequence/{job_id}")
def status(job_id: str):
    if job_id != JOB_ID:
        raise HTTPException(404)
    with lock:
        return snapshot()


@app.get("/frames/{index}.png")
def frame(index: int):
    if not manifest_file.is_file() or not 0 <= index < 7:
        raise HTTPException(404)
    path = cache / f"{index:02d}.png"
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
