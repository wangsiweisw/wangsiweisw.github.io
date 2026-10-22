"""Forecast map data: the latest AIFS, IFS and GFS runs, cropped around each city in src/data/forecast-cities.json.

    python scripts/forecast-data/build.py [--out public/fx] [--cities nyc,london] [--hours 240]

Runs in CI before `astro build` (see .github/workflows/deploy.yml). Sources, all open data with no request quotas:
  - ECMWF AIFS and IFS (CC BY 4.0) from ECMWF's open-data server (or its AWS mirror)
  - NOAA GFS (public domain) from the NOAA open-data bucket on AWS
Only the needed fields are downloaded (byte ranges from each file's index).

Output, per city / model / field: one 8-bit grayscale PNG with every 6-hourly step stacked vertically (row block i =
step i), plus manifest.json with the grid, run times and how to turn pixel values back into numbers.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import io
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import eccodes
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
# ECMWF's own open-data server first; the AWS mirror answers "503 Slow Down" under load
ECMWF_HOSTS = ["https://data.ecmwf.int/forecasts", "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com"]
ECMWF = ECMWF_HOSTS[0]
GFS = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
RES = 0.5  # degrees: the 0.25° source, every other point (plenty for a regional map, a quarter of the bytes)
STEP = 6  # hours between frames (AIFS's native step)

# field -> how each model names it
FIELDS = {
    "t2m": {"ecmwf": ("2t", None), "gfs": "TMP:2 m above ground"},
    "tp": {"ecmwf": ("tp", None), "gfs": "APCP:surface:0-"},  # accumulated since the start of the run
    "u10": {"ecmwf": ("10u", None), "gfs": "UGRD:10 m above ground"},
    "v10": {"ecmwf": ("10v", None), "gfs": "VGRD:10 m above ground"},
    "msl": {"ecmwf": ("msl", None), "gfs": "PRMSL:mean sea level"},
    "z500": {"ecmwf": ("gh", "500"), "gfs": "HGT:500 mb"},
}
MODELS = {"aifs": "aifs-single", "ifs": "ifs", "gfs": None}


def get(url: str, rng: tuple[int, int | str] | None = None, tries: int = 7) -> bytes:
    """GET with retries; S3 answers "503 Slow Down" when asked too fast, so back off exponentially."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(min(30, 1.5 * 2**attempt))
    raise AssertionError


def exists(url: str) -> bool:
    """HEAD: True if published, False on 403/404; throttling (503) is retried rather than read as missing."""
    for attempt in range(6):
        try:
            urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return False
        except Exception:
            pass
        time.sleep(min(30, 1.5 * 2**attempt))
    return False


# --- where each model's fields live ---------------------------------------------------------------------------


def ecmwf_url(model: str, run: dt.datetime, step: int, ext: str) -> str:
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    return f"{ECMWF}/{d}/{h}z/{MODELS[model]}/0p25/oper/{d}{h}0000-{step}h-oper-fc.{ext}"


def gfs_url(run: dt.datetime, step: int, ext: str = "") -> str:
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    return f"{GFS}/gfs.{d}/{h}/atmos/gfs.t{h}z.pgrb2.0p25.f{step:03d}{ext}"


def latest_run(model: str, hours: int) -> dt.datetime:
    """Newest 00z/12z run (06z/18z for GFS too) whose last step is already published."""
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    cycle = 6 if model == "gfs" else 12
    run = now.replace(hour=now.hour - now.hour % cycle)
    for _ in range(8):
        url = gfs_url(run, hours, ".idx") if model == "gfs" else ecmwf_url(model, run, hours, "index")
        if exists(url):
            return run
        run -= dt.timedelta(hours=cycle)
    raise RuntimeError(f"no complete {model} run found")


def ranges(model: str, run: dt.datetime, step: int) -> dict[str, tuple[str, tuple[int, int]]]:
    """field -> (url, byte range) for one step."""
    out = {}
    if model == "gfs":
        url = gfs_url(run, step)
        lines = get(gfs_url(run, step, ".idx")).decode().splitlines()
        starts = [int(line.split(":")[1]) for line in lines]
        for name, spec in FIELDS.items():
            if name == "tp" and step == 0:
                continue
            for i, line in enumerate(lines):
                if spec["gfs"] in line and (name != "tp" or "acc fcst" in line):
                    end = starts[i + 1] - 1 if i + 1 < len(lines) else ""
                    out[name] = (url, (starts[i], end))
                    break
    else:
        url = ecmwf_url(model, run, step, "grib2")
        for line in get(ecmwf_url(model, run, step, "index")).decode().splitlines():
            e = json.loads(line)
            for name, spec in FIELDS.items():
                param, level = spec["ecmwf"]
                if e["param"] == param and e.get("levelist") == level:
                    out[name] = (url, (e["_offset"], e["_offset"] + e["_length"] - 1))
    return out


# --- decoding and cropping --------------------------------------------------------------------------------------


def decode(msg: bytes) -> tuple[np.ndarray, float, float, str]:
    """Global 0.25° field as [lat, lon] (north first), its first latitude and longitude, and its units."""
    h = eccodes.codes_new_from_message(msg)
    try:
        ni, nj = eccodes.codes_get(h, "Ni"), eccodes.codes_get(h, "Nj")
        lat0 = eccodes.codes_get(h, "latitudeOfFirstGridPointInDegrees")
        lon0 = eccodes.codes_get(h, "longitudeOfFirstGridPointInDegrees")
        units = eccodes.codes_get(h, "units")
        vals = eccodes.codes_get_values(h).reshape(nj, ni)
    finally:
        eccodes.codes_release(h)
    return vals, lat0, lon0, units


def crop(field: np.ndarray, lat0: float, lon0: float, box: dict) -> np.ndarray:
    lats = np.arange(box["n"], box["s"] - 1e-6, -RES)
    lons = np.arange(box["w"], box["e"] + 1e-6, RES)
    rows = np.rint((lat0 - lats) / 0.25).astype(int)
    cols = np.rint(((lons - lon0) % 360) / 0.25).astype(int) % field.shape[1]
    return field[np.ix_(rows, cols)]


def region(city: dict) -> dict:
    """Same area the map allows (see load() in ForecastMap.astro), snapped to the grid."""
    lat_half = 15
    lon_half = min(45, 20 / math.cos(math.radians(city["lat"])))
    snap = lambda x, f: f(x / RES) * RES  # noqa: E731
    return {
        "s": snap(max(-80, city["lat"] - lat_half), math.floor),
        "n": snap(min(80, city["lat"] + lat_half), math.ceil),
        "w": snap(city["lon"] - lon_half, math.floor),
        "e": snap(city["lon"] + lon_half, math.ceil),
    }


# --- packing ----------------------------------------------------------------------------------------------------


def to_units(name: str, units: str, a: np.ndarray) -> np.ndarray:
    if name == "t2m":
        return a - 273.15  # °C
    if name == "tp":
        # mm: IFS stores metres of water, AIFS and GFS kg/m² (= mm)
        return a * 1000 if units == "m" else a
    if name in ("u10", "v10"):
        return a * 3.6  # km/h, like the rest of the site
    if name == "msl":
        return a / 100  # hPa
    return a  # z500: geopotential height in m


def pack(frames: list[np.ndarray], sqrt: bool) -> tuple[Image.Image, float, float]:
    """Stack frames into one grayscale image; value = lo + (px/255)·(hi−lo), or squared for sqrt-scaled fields."""
    stack = np.stack(frames)
    lo, hi = float(np.nanmin(stack)), float(np.nanmax(stack))
    if sqrt:
        lo = 0.0
        norm = np.sqrt(np.clip(stack, 0, None) / max(hi, 1e-6))
    else:
        norm = (stack - lo) / max(hi - lo, 1e-6)
    px = np.rint(np.nan_to_num(norm) * 255).astype(np.uint8)
    return Image.fromarray(px.reshape(-1, px.shape[2]), mode="L"), round(lo, 3), round(hi, 3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "public" / "fx"))
    ap.add_argument("--cities", default="")
    ap.add_argument("--hours", type=int, default=240)
    ap.add_argument("--models", default="aifs,ifs,gfs")
    args = ap.parse_args()

    cities = json.loads((ROOT / "src" / "data" / "forecast-cities.json").read_text())
    if args.cities:
        cities = [c for c in cities if c["id"] in args.cities.split(",")]
    boxes = {c["id"]: region(c) for c in cities}
    steps = list(range(0, args.hours + 1, STEP))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    manifest: dict = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "res": RES,
        "steps": steps,
        "cities": {cid: {**b, "rows": round((b["n"] - b["s"]) / RES) + 1, "cols": round((b["e"] - b["w"]) / RES) + 1} for cid, b in boxes.items()},
        "models": {},
    }

    # AIFS and IFS should share a run so "AIFS − IFS" compares like with like
    global ECMWF
    for host in ECMWF_HOSTS:
        ECMWF = host
        if exists(f"{host}/"):
            break
    runs = {m: latest_run(m, args.hours) for m in args.models.split(",")}
    if "aifs" in runs and "ifs" in runs:
        runs["aifs"] = runs["ifs"] = min(runs["aifs"], runs["ifs"])

    for model, run in runs.items():
        t0 = time.time()
        # field -> city -> list of frames
        frames: dict[str, dict[str, list[np.ndarray]]] = {f: {c: [] for c in boxes} for f in FIELDS}

        # every (step, field) download in one queue: indexes first, then the fields, many at a time
        workers = 16 if model == "gfs" else 8
        with cf.ThreadPoolExecutor(workers) as pool:
            parts = dict(zip(steps, pool.map(lambda st: ranges(model, run, st), steps)))

            def fetch(job):
                step, name, url, rng = job
                vals, lat0, lon0, units = decode(get(url, rng))
                return step, name, {cid: to_units(name, units, crop(vals, lat0, lon0, box)) for cid, box in boxes.items()}

            jobs = [(st, name, url, rng) for st, p in parts.items() for name, (url, rng) in p.items()]
            results: dict[int, dict] = {st: {} for st in steps}
            for step, name, got in pool.map(fetch, jobs):
                results[step][name] = got
        for step in steps:
            for name in FIELDS:
                for cid in boxes:
                    if name in results[step]:
                        frames[name][cid].append(results[step][name][cid])
                    else:  # no precipitation total at step 0
                        frames[name][cid].append(np.zeros_like(results[step]["t2m"][cid]))

        files = {}
        for cid in boxes:
            # precipitation per 6 h from the running total; the last frame of the total is the 10-day sum
            total = frames["tp"][cid]
            per_step = [np.zeros_like(total[0])] + [np.clip(b - a, 0, None) for a, b in zip(total, total[1:])]
            fields = {**{n: frames[n][cid] for n in ("t2m", "u10", "v10", "msl", "z500")}, "tp6": per_step, "tptot": [total[-1]]}
            for name, fr in fields.items():
                img, lo, hi = pack(fr, sqrt=name in ("tp6", "tptot"))
                path = f"{cid}/{model}-{name}.png"
                (out / cid).mkdir(exist_ok=True)
                img.save(out / path, optimize=True)
                files[f"{cid}/{name}"] = {"file": path, "lo": lo, "hi": hi, "scale": "sqrt" if name in ("tp6", "tptot") else "linear"}
        manifest["models"][model] = {"run": run.isoformat(timespec="minutes"), "files": files}
        print(f"{model} {run:%Y-%m-%d %Hz}: {len(steps)} steps in {time.time() - t0:.0f}s", file=sys.stderr)

    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    size = sum(p.stat().st_size for p in out.rglob("*.png"))
    print(f"wrote {out} ({size / 1e6:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
