"""Render a fixed Barnard's Star field from real NEOWISE W1 cutouts."""
import gzip
import io
import math
import re
from time import monotonic
from pathlib import Path

import numpy as np
import requests
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import ascii, fits
from astropy.time import Time
from astropy.wcs import WCS
from PIL import Image
from reproject import reproject_interp

IRSA = "https://irsa.ipac.caltech.edu/ibe"
COLLECTION = "wise/neowiser/p1bm_frm"
# SIMBAD ICRS J2000 position and Gaia EDR3 proper motion (mas/year).
CATALOG_URL = "https://simbad.harvard.edu/simbad/sim-id?Ident=Barnard%27s+star"
J2000 = SkyCoord("17h57m48.4984700685s", "+04d41m36.113879676s")


def predicted_position(epoch):
    years = epoch.jyear - 2000
    return J2000.spherical_offsets_by(-801.551 * years * u.mas, 10362.394 * years * u.mas)


CENTER = predicted_position(Time(2019, format="jyear"))
SHAPE = (128, 128)
# NEOWISE supplement section IV.2.a, exclude unreliable measurements.
# Mask unusable pixels, including saturation and unreliable linearity.
BAD_BITS = 1504706175 | (1 << 26)


class InsufficientData(Exception):
    pass


def download(session, url, params=None, limit=4_000_000):
    deadline = monotonic() + 30
    with session.get(url, params=params, timeout=(8, 18), stream=True,
                     allow_redirects=False) as reply:
        if reply.status_code != 200:
            raise requests.HTTPError(f"IRSA HTTP {reply.status_code}", response=reply)
        data = bytearray()
        for chunk in reply.iter_content(65536):
            if monotonic() > deadline:
                raise requests.Timeout('IRSA download took too long')
            data.extend(chunk)
            if len(data) > limit:
                raise ValueError("IRSA response exceeded the download limit")
    if data.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
            data = compressed.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Decompressed IRSA response exceeded the download limit")
    return bytes(data)


def visits(session, center=CENTER):
    try:
        content = download(session, f"{IRSA}/search/{COLLECTION}",
                           {"POS": f"{center.ra.deg:.8f},{center.dec.deg:.8f}",
                            "ct": "ipac_table", "columns": "scan_id,frame_num,band,mjd,qual_frame",
                            "where": "band=1"})
        rows = ascii.read(content.decode("utf-8"), format="ipac")
    except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as error:
        if isinstance(error, requests.HTTPError) and error.response.status_code < 500:
            raise
        # The source catalog also identifies real exposures of the fixed field.
        content = download(session, "https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query",
                           {"catalog": "neowiser_p1bs_psd", "spatial": "Cone",
                            "objstr": f"{center.ra.deg:.8f} {center.dec.deg:.8f}",
                            "radius": 2, "radunits": "arcmin", "outfmt": 1,
                            "selcols": "scan_id,frame_num,mjd"})
        detections = ascii.read(content.decode("utf-8"), format="ipac")
        exposures = {}
        for row in detections:
            key = str(row["scan_id"]), int(row["frame_num"])
            exposures[key] = {"scan_id": key[0], "frame_num": key[1],
                              "mjd": float(row["mjd"]), "band": 1, "qual_frame": 5}
        rows = exposures.values()
    groups = []
    for row in sorted(rows, key=lambda row: float(row["mjd"])):
        if int(row["band"]) != 1 or int(row["qual_frame"]) < 5:
            continue
        if not groups or float(row["mjd"]) - float(groups[-1][-1]["mjd"]) > 30:
            groups.append([])
        groups[-1].append(row)
    return groups


def output_grid(center=CENTER, field=4):
    grid = WCS(naxis=2)
    grid.wcs.crpix = [(n + 1) / 2 for n in SHAPE]
    grid.wcs.crval = [center.ra.deg, center.dec.deg]
    grid.wcs.cdelt = [-field / 60 / SHAPE[1], field / 60 / SHAPE[0]]
    grid.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    grid.wcs.radesys = "ICRS"
    return grid


def read_exposure(session, row, grid, center=CENTER, field=4):
    scan = str(row["scan_id"])
    number = int(row["frame_num"])
    if not re.fullmatch(r"[0-9]{5}[a-z]", scan) or not 0 <= number <= 999:
        raise ValueError("Unexpected IRSA exposure identifier")
    product = f"{scan}{number:03d}-w1"
    prefix = f"{IRSA}/data/{COLLECTION}/{scan[-2:]}/{scan}/{number:03d}/{product}"
    source = prefix + "-int-1b.fits"
    params = {"center": f"{center.ra.deg:.8f},{center.dec.deg:.8f}", "size": f"{field + 1}arcmin"}
    with fits.open(io.BytesIO(download(session, source, params))) as science, fits.open(
        io.BytesIO(download(session, prefix + "-msk-1b.fits.gz", params))
    ) as mask:
        header = science[0].header
        if header.get("SAA_SEP", 1) <= 0 or header.get("MOON_SEP", 25) <= 24:
            return None
        image = np.asarray(science[0].data, dtype=float)
        flags = np.asarray(mask[0].data, dtype=np.int64)
        if flags.shape != image.shape:
            return None
        image[(flags & BAD_BITS) != 0] = np.nan
        input_wcs = WCS(science[0].header).celestial
        valid = np.isfinite(image)
        aligned, footprint = reproject_interp((np.where(valid, image, 0), input_wcs),
                                               grid, shape_out=SHAPE)
        weights, _ = reproject_interp((valid.astype(float), input_wcs), grid, shape_out=SHAPE)
        aligned = np.divide(aligned, weights, out=np.full(SHAPE, np.nan), where=weights > .65)
    aligned[footprint == 0] = np.nan
    epoch = Time(float(header.get("MJD_OBS", row["mjd"])), format="mjd", scale="utc")
    if np.isfinite(aligned).mean() < .94:
        return None
    if center is CENTER:
        x, y = grid.world_to_pixel(predicted_position(epoch))
        ix, iy = round(float(x)), round(float(y))
        if not (12 <= ix < SHAPE[1] - 12 and 12 <= iy < SHAPE[0] - 12):
            return None
        # The bright core can be saturated. Require usable data in the surrounding wings.
        offsets = np.arange(-12, 13)
        separation = np.hypot(offsets[:, None], offsets[None, :])
        wings = aligned[iy-12:iy+13, ix-12:ix+13][(separation >= 7) & (separation <= 12)]
        if np.isfinite(wings).mean() < .55:
            return None
    aligned -= np.nanmedian(aligned)
    # Normalize calibrated exposures to a shared flux scale before display.
    if "MAGZP" in header:
        aligned *= 10 ** ((20 - float(header["MAGZP"])) / 2.5)
    return aligned, {"observedAt": epoch.isot + "Z", "productId": product,
                     "band": "NEOWISE W1 · 3.4 µm", "sourceUrl": source}



def render(directory: Path, progress, *, center=CENTER, field=4,
           route="/timelapse/barnard-star/frames"):
    grid = output_grid(center, field)
    manifest = {"center": [float(center.ra.deg), float(center.dec.deg)],
                "fieldArcmin": field, "frames": []}
    if center is CENTER:
        manifest.update(target="Barnard's Star", catalogUrl=CATALOG_URL)
    frames = []
    stretch = None
    deadline = monotonic() + 235
    failed = None

    with requests.Session() as session:
        session.headers["User-Agent"] = "SIEVE-Observatory-NEOWISE/2"
        groups = visits(session, center)
        if len(groups) < 2:
            raise InsufficientData
        intermediate = list(dict.fromkeys(np.linspace(1, len(groups) - 2, min(5, len(groups) - 2), dtype=int)))
        order = [0, len(groups) - 1, *intermediate]
        for count, index in enumerate(order, start=1):
            message = f"Checking observation visit {count} of {len(order)}."
            progress(message, manifest if stretch else None)
            for row in sorted(groups[index], key=lambda item: -int(item["qual_frame"]))[:4]:
                if monotonic() > deadline:
                    if stretch:
                        return manifest
                    raise requests.Timeout("IRSA sequence exceeded its time budget")
                try:
                    frame = read_exposure(session, row, grid, center, field)
                except requests.HTTPError as error:
                    if error.response.status_code not in (400, 404, 416):
                        failed = error
                    continue
                except (requests.ConnectionError, requests.Timeout) as error:
                    failed = error
                    continue
                if frame is not None:
                    frames.append(frame)
                    break
            if len(frames) < 2:
                continue
            if stretch is None:
                pixels = np.concatenate([array[np.isfinite(array)] for array, _ in frames])
                low, high = np.percentile(pixels, [15, 99.6])
                if not math.isfinite(high) or high <= low:
                    raise InsufficientData
                stretch = low, high
            for array, metadata in frames[len(manifest["frames"]):]:
                low, high = stretch
                scaled = np.clip((array - low) / (high - low), 0, 1)
                gray = np.uint8(np.nan_to_num(np.arcsinh(8 * scaled) / np.arcsinh(8)) * 255)
                alpha = np.uint8(np.isfinite(array) * 255)
                filename = (f'{len(manifest["frames"]):02d}' if center is CENTER else metadata["productId"]) + ".png"
                temporary = directory / (filename + ".tmp")
                Image.fromarray(np.flipud(np.stack((gray, alpha), axis=-1))).save(temporary, format="PNG")
                temporary.replace(directory / filename)
                manifest["frames"].append({**metadata, "imageUrl": f"{route}/{filename}"})
            manifest["frames"].sort(key=lambda frame: frame["observedAt"])
            progress(message, manifest)
    if not stretch:
        if failed:
            raise failed
        raise InsufficientData
    return manifest
