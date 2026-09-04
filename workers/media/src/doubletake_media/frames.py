"""Key-frame sampling: scene changes (ffmpeg select) + first/last frame, capped per mode."""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from . import ffmpeg
from .errors import WorkerError

SCENE_THRESHOLD = 0.3
MAX_EDGE = 1280
JPEG_Q = 85  # ffmpeg -q:v 2 ≈ libjpeg quality 85-90


@dataclass(frozen=True)
class Frame:
    path: Path
    ts: float
    score: float


def select(candidates: list[tuple[float, float]], *, budget: int, duration: float) -> list[float]:
    """Pick timestamps: always first (0) and last frame, then the highest-scoring scene changes.

    ``candidates`` are (timestamp, scene_score) pairs. Pure so tests can cover it without ffmpeg.
    """
    if budget <= 0:
        return []
    last_ts = max(duration - 0.5, 0.0)
    anchors = [0.0] if budget == 1 else [0.0, round(last_ts, 3)]
    picked: list[float] = list(dict.fromkeys(anchors))
    room = budget - len(picked)
    for ts, _score in sorted(candidates, key=lambda c: -c[1]):
        if room <= 0:
            break
        if all(abs(ts - p) > 0.75 for p in picked):
            picked.append(round(ts, 3))
            room -= 1
    return sorted(picked)


_SHOWINFO = re.compile(r"pts_time:\s*([\d.]+).*?scene_score=([\d.]+)|pts_time:\s*([\d.]+)")
_SCENE = re.compile(r"lavfi\.scene_score=([\d.]+)")


def scene_changes(src: Path, *, max_seconds: float | None) -> list[tuple[float, float]]:
    """Run the scene detector once and parse timestamps + scores from stderr."""
    args = ["-i", str(src)]
    if max_seconds:
        args = ["-t", f"{max_seconds:.0f}", *args]
    args += [
        "-vf",
        f"select='gt(scene,{SCENE_THRESHOLD})',metadata=print",
        "-an",
        "-f",
        "null",
        "-",
    ]
    res = ffmpeg.run(args, timeout=900)
    out: list[tuple[float, float]] = []
    ts: float | None = None
    for line in res.stderr.splitlines():
        m = re.search(r"pts_time:\s*([\d.]+)", line)
        if m:
            ts = float(m.group(1))
            continue
        s = _SCENE.search(line)
        if s and ts is not None:
            out.append((ts, float(s.group(1))))
            ts = None
    return out


def grab(src: Path, timestamps: list[float], frames_dir: Path) -> list[Frame]:
    """Extract one JPEG per timestamp as frames/000123.jpg (index = seconds*10)."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Frame] = []
    scale = f"scale='if(gt(iw,ih),min(iw,{MAX_EDGE}),-2)':'if(gt(iw,ih),-2,min(ih,{MAX_EDGE}))'"
    for ts in timestamps:
        name = frames_dir / f"{int(round(ts * 10)):06d}.jpg"
        res = ffmpeg.run(
            [
                "-ss",
                f"{ts:.3f}",
                "-i",
                str(src),
                "-frames:v",
                "1",
                "-vf",
                scale,
                "-q:v",
                "2",
                str(name),
            ],
            timeout=120,
        )
        if res.returncode == 0 and name.exists():
            frames.append(Frame(path=name, ts=round(ts, 3), score=0.0))
    return frames


def image_as_frame(src: Path, frames_dir: Path) -> list[Frame]:
    """A still image is its own single frame (re-encoded to bounded JPEG)."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    name = frames_dir / "000000.jpg"
    scale = f"scale='if(gt(iw,ih),min(iw,{MAX_EDGE}),-2)':'if(gt(iw,ih),-2,min(ih,{MAX_EDGE}))'"
    res = ffmpeg.run(["-i", str(src), "-vf", scale, "-q:v", "2", str(name)], timeout=60)
    if res.returncode != 0:
        if src.suffix.lower() in {".jpg", ".jpeg"}:
            shutil.copy(src, name)
        else:
            raise WorkerError("download_failed", f"image decode failed: {res.stderr[-200:]}")
    return [Frame(path=name, ts=0.0, score=0.0)]
