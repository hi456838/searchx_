"""Persistent single-instance queue for coordinate-based NEOWISE sequences."""
import hashlib
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from time import monotonic

from astropy.coordinates import SkyCoord
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from pipeline import InsufficientData, render

router = APIRouter()
lock = Lock()
pool = ThreadPoolExecutor(max_workers=1)
active = set()
recent = []
last_prefetch = -60.0
root = None
VERSION = "neowise-w1-v2"


def read(job):
    path = root / job / "state.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def write(job, result):
    path = root / job / "state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(result), encoding="utf-8")
    temp.replace(path)


def build(job, center, field):
    def update(message, manifest=None, status="running"):
        result = {"status": status, "jobId": job, "message": message}
        if manifest:
            result["manifest"] = manifest
        write(job, result)

    try:
        manifest = render(root / job, update, center=center, field=field,
                          route=f"/timelapse/regions/{job}/frames")
        update("", manifest, "ready")
    except InsufficientData:
        update("Not enough comparable observations for this region.", status="insufficient")
    except Exception:
        import logging
        logging.exception("Region time-lapse failed: %s", job)
        previous = read(job) or {}
        update("IRSA processing could not finish. Try again.", previous.get("manifest"), "error")
    finally:
        with lock:
            active.discard(job)


def reply(result):
    return JSONResponse(result, status_code=202 if result["status"] == "running" else 200,
                        headers={"Cache-Control": "no-store"})


@router.post("/regions")
def start(ra: float = Query(ge=0, lt=360), dec: float = Query(ge=-90, le=90),
          field: float = Query(default=4, ge=2, le=6), prefetch: bool = False):
    global last_prefetch
    if not all(map(math.isfinite, (ra, dec, field))):
        raise HTTPException(422)
    ra, dec, field = (round(float(value), 6) + 0.0 for value in (ra, dec, field))
    ra %= 360
    if abs(dec) == 90:
        ra = 0.0
    # Rounding moves the centre by at most 0.003 arcseconds.
    key = f"{VERSION}:{ra:.6f}:{dec:.6f}:{field:.6f}"
    job = hashlib.sha256(key.encode()).hexdigest()[:32]
    with lock:
        prior = read(job)
        if prior and (job in active or prior["status"] in ("ready", "insufficient")):
            return reply(prior)
        now = monotonic()
        recent[:] = [time for time in recent if now - time < 60]
        if len(active) >= 4 or len(recent) >= 8:
            raise HTTPException(429, "The time-lapse queue is busy. Try again shortly.")
        if prefetch and (active or now - last_prefetch < 30):
            return JSONResponse({"status": "deferred"}, headers={"Cache-Control": "no-store"})
        if prefetch:
            last_prefetch = now
        initial = {"status": "running", "jobId": job, "message": "Looking for NEOWISE W1 observations."}
        if prior and prior.get("manifest"):
            initial["manifest"] = prior["manifest"]
        write(job, initial)
        active.add(job)
        recent.append(now)
        pool.submit(build, job, SkyCoord(ra, dec, unit="deg", frame="icrs"), field)
        return reply(initial)


@router.get("/regions/{job}")
def status(job: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job):
        raise HTTPException(404)
    with lock:
        result = read(job)
        if result is None:
            raise HTTPException(404)
        if result["status"] == "running" and job not in active:
            return reply({**result, "status": "error", "message": "The worker restarted. Try again."})
        return reply(result)


@router.get("/regions/{job}/frames/{product}.png")
def frame(job: str, product: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job) or not re.fullmatch(r"[0-9]{5}[a-z][0-9]{3}-w1", product):
        raise HTTPException(404)
    path = root / job / (product + ".png")
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})
