"""Thin wrappers around ffmpeg/ffprobe (system binaries; `scripts/doctor.sh` checks for them)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from .errors import WorkerError


def _bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise WorkerError("tool_missing", f"{name} not found on PATH (brew/apt install ffmpeg)")
    return path


def probe(path: Path) -> dict[str, object]:
    """Duration, width, height, has_audio, has_video for a media file."""
    out = subprocess.run(
        [
            _bin("ffprobe"),
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if out.returncode != 0:
        raise WorkerError("download_failed", f"ffprobe failed: {out.stderr.strip()[-300:]}")
    info = json.loads(out.stdout or "{}")
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = info.get("format", {})
    duration = float(fmt.get("duration") or (video or {}).get("duration") or 0.0)
    return {
        "duration_s": round(duration, 3),
        "width": int(video["width"]) if video and video.get("width") else None,
        "height": int(video["height"]) if video and video.get("height") else None,
        "has_video": video is not None,
        "has_audio": audio is not None,
        # still images decode as a single-frame "video" stream
        "is_image": bool(video) and (video.get("codec_name") in {"mjpeg", "png", "webp", "gif"}),
    }


def run(args: list[str], *, timeout: float = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_bin("ffmpeg"), "-hide_banner", "-nostdin", "-y", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
