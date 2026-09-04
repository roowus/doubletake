"""Transcription: captions from yt-dlp when present, otherwise local Whisper.

Backends (``DOUBLETAKE_WHISPER_BACKEND``): ``auto`` (mlx-whisper on Apple Silicon, else
faster-whisper), ``mlx``, ``faster``, ``off``. All run on-device; audio never leaves the machine.
"""

from __future__ import annotations

import os
import platform
import re
from collections.abc import Callable
from pathlib import Path

from . import ffmpeg
from .errors import WorkerError

Segment = dict[str, object]  # {"start": float, "end": float, "text": str}

MLX_MODELS = {
    "quick": "mlx-community/whisper-small-mlx",
    "standard": "mlx-community/whisper-large-v3-turbo",
    "deep": "mlx-community/whisper-large-v3-turbo",
}
FASTER_MODELS = {"quick": "small", "standard": "medium", "deep": "large-v3-turbo"}


def backend() -> str:
    want = os.environ.get("DOUBLETAKE_WHISPER_BACKEND", "auto").strip().lower() or "auto"
    if want != "auto":
        return want
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "mlx"
    return "faster"


def extract_audio(src: Path, out_dir: Path, *, max_seconds: float | None) -> Path | None:
    """16 kHz mono WAV; returns None when the file has no audio stream."""
    if not ffmpeg.probe(src)["has_audio"]:
        return None
    wav = out_dir / "audio.wav"
    args = ["-i", str(src)]
    if max_seconds:
        args += ["-t", f"{max_seconds:.0f}"]
    args += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)]
    res = ffmpeg.run(args)
    if res.returncode != 0 or not wav.exists():
        raise WorkerError("download_failed", f"audio extraction failed: {res.stderr[-300:]}")
    return wav


def has_speech(wav: Path) -> bool:
    """Cheap silence gate: ffmpeg volumedetect mean volume above -50 dB."""
    res = ffmpeg.run(["-i", str(wav), "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", res.stderr)
    return m is None or float(m.group(1)) > -50.0


# ---- captions -------------------------------------------------------------------------

_TS = re.compile(r"(\d+):(\d\d):(\d\d)[.,](\d{1,3})|(\d\d):(\d\d)[.,](\d{1,3})")


def _ts(s: str) -> float:
    m = _TS.fullmatch(s.strip())
    if not m:
        return 0.0
    if m.group(1) is not None:
        h, mi, se, ms = m.group(1, 2, 3, 4)
    else:
        h, (mi, se, ms) = "0", m.group(5, 6, 7)
    return int(h) * 3600 + int(mi) * 60 + int(se) + int(ms.ljust(3, "0")) / 1000


def parse_captions(path: Path) -> list[Segment]:
    """WebVTT/SRT → segments, dropping tags and the rolling duplicates YouTube auto-subs emit."""
    text = path.read_text(encoding="utf-8", errors="replace")
    segs: list[Segment] = []
    last = ""
    for block in re.split(r"\n\s*\n", text):
        lines = [ln for ln in block.strip().splitlines() if ln.strip()]
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            continue
        start_s, end_s = (p.strip().split(" ")[0] for p in lines[idx].split("-->")[:2])
        body = " ".join(re.sub(r"<[^>]+>", "", ln) for ln in lines[idx + 1 :]).strip()
        body = re.sub(r"\s+", " ", body)
        if not body or body == last:
            continue
        if last and body.startswith(last):
            body_new = body[len(last) :].strip()
            if not body_new:
                continue
        last = body
        segs.append({"start": round(_ts(start_s), 2), "end": round(_ts(end_s), 2), "text": body})
    return segs


# ---- whisper ------------------------------------------------------------------------------


def transcribe(
    wav: Path, *, mode: str, progress: Callable[[int, str], None]
) -> tuple[str, str, list[Segment]]:
    """Returns (tool, language, segments)."""
    be = backend()
    if be == "off":
        raise WorkerError("no_speech", "transcription disabled (DOUBLETAKE_WHISPER_BACKEND=off)")
    if be == "mlx":
        return _mlx(wav, mode, progress)
    if be == "faster":
        return _faster(wav, mode, progress)
    raise WorkerError("worker_error", f"unknown whisper backend {be!r}")


def _mlx(
    wav: Path, mode: str, progress: Callable[[int, str], None]
) -> tuple[str, str, list[Segment]]:
    try:
        import mlx_whisper  # type: ignore[import-not-found]
    except ImportError as e:
        raise WorkerError(
            "tool_missing", "mlx-whisper not installed: uv sync --extra whisper-mlx"
        ) from e
    model = MLX_MODELS.get(mode, MLX_MODELS["standard"])
    progress(10, f"mlx-whisper {model.rsplit('/', 1)[-1]}")
    out = mlx_whisper.transcribe(str(wav), path_or_hf_repo=model, word_timestamps=False)
    segs = [
        {
            "start": round(float(s["start"]), 2),
            "end": round(float(s["end"]), 2),
            "text": s["text"].strip(),
        }
        for s in out.get("segments", [])
        if s.get("text", "").strip()
    ]
    return f"mlx-whisper:{model.rsplit('/', 1)[-1]}", str(out.get("language") or "und"), segs


def _faster(
    wav: Path, mode: str, progress: Callable[[int, str], None]
) -> tuple[str, str, list[Segment]]:
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError as e:
        raise WorkerError(
            "tool_missing", "faster-whisper not installed: uv sync --extra whisper-cpu"
        ) from e
    name = FASTER_MODELS.get(mode, FASTER_MODELS["standard"])
    progress(10, f"faster-whisper {name}")
    model = WhisperModel(name, device="cpu", compute_type="int8")
    it, info = model.transcribe(str(wav), vad_filter=True)
    segs = [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in it
        if s.text.strip()
    ]
    return f"faster-whisper:{name}", info.language or "und", segs
