"""The `extract` op: download → transcript → frames → OCR → (vision) → result envelope."""

from __future__ import annotations

import time
from collections.abc import Mapping
from pathlib import Path

from . import download, ocr, transcribe, vision
from . import frames as frames_mod
from .errors import WorkerError
from .protocol import Progress

DEFAULT_BUDGET = {"frames": 12, "vision_frames": 6, "comments": 100, "transcribe_model": "standard"}


def _budget(params: Mapping[str, object]) -> dict[str, int | str]:
    b = dict(DEFAULT_BUDGET)
    raw = params.get("budget")
    if isinstance(raw, Mapping):
        for k in b:
            if k in raw and raw[k] is not None:
                b[k] = raw[k]  # type: ignore[assignment]
    return b  # type: ignore[return-value]


def _asset(path: Path, kind: str, source: str, **extra: object) -> dict[str, object]:
    return {
        "kind": kind,
        "path": str(path),
        "sha256": download.sha256_of(path),
        "bytes": path.stat().st_size,
        "source": source,
        **{k: v for k, v in extra.items() if v is not None},
    }


def _timed(fn, *a, **kw):  # noqa: ANN001, ANN202 - small helper
    t0 = time.monotonic()
    out = fn(*a, **kw)
    return out, int((time.monotonic() - t0) * 1000)


def handle_extract(params: Mapping[str, object], progress: Progress) -> dict[str, object]:
    url = str(params.get("url") or "")
    if not url:
        raise WorkerError("bad_request", "extract needs a url")
    out_dir = Path(str(params.get("out_dir") or ""))
    if not out_dir.is_absolute():
        raise WorkerError("bad_request", "out_dir must be absolute")
    out_dir.mkdir(parents=True, exist_ok=True)
    platform = str(params.get("platform") or "web")
    mode = str(params.get("mode") or "standard")
    hints = params.get("hints") if isinstance(params.get("hints"), Mapping) else {}
    budget = _budget(params)

    assets: list[dict[str, object]] = []
    extractions: list[dict[str, object]] = []
    warnings: list[str] = []
    vision_requests: list[dict[str, object]] = []

    # 1. download -----------------------------------------------------------------------------
    def dl_progress(pct: int, detail: str) -> None:
        progress("download", pct, detail)

    cdn = hints.get("cdn_url") if hints else None
    dl: download.Downloaded | None = None
    if isinstance(cdn, str) and cdn:
        try:
            dl = download.download_direct(cdn, out_dir, dl_progress)
        except WorkerError as e:
            warnings.append(f"CDN download failed ({e.message}); falling back to yt-dlp.")
    if dl is None:
        dl = download.download_ytdlp(
            url,
            out_dir,
            platform=platform,
            mode=mode,
            comments_budget=int(budget["comments"]),
            progress=dl_progress,
        )
    warnings.extend(dl.warnings)
    result: dict[str, object] = {
        "assets": assets,
        "extractions": extractions,
        "vision_requests": vision_requests,
        "warnings": warnings,
        "canonical_url": dl.canonical_url,
        "title": dl.title,
    }
    if dl.comments:
        extractions.append(
            {
                "kind": "comments",
                "tool": "yt-dlp",
                "duration_ms": 0,
                "content": {"total": dl.comment_count or len(dl.comments), "sampled": dl.comments},
            }
        )
    if dl.path is None:
        return result
    assets.append(
        _asset(
            dl.path,
            dl.kind,
            dl.source,
            duration_s=dl.duration_s,
            width=dl.width,
            height=dl.height,
        )
    )
    cap = download.DURATION_CAP_S.get(mode, download.DURATION_CAP_S["standard"])
    limit = cap if (dl.duration_s or 0) > cap else None

    # 2. transcript ---------------------------------------------------------------------------
    if dl.kind in {"video", "audio"}:
        progress("transcribe", 0, "captions" if dl.captions_path else "audio")
        if dl.captions_path is not None:
            segs, ms = _timed(transcribe.parse_captions, dl.captions_path)
            if segs:
                extractions.append(
                    {
                        "kind": "transcript",
                        "tool": "captions",
                        "duration_ms": ms,
                        "content": {"language": "en", "segments": segs},
                    }
                )
        if not any(e["kind"] == "transcript" for e in extractions):
            try:
                wav = transcribe.extract_audio(dl.path, out_dir, max_seconds=limit)
                if wav is None or not transcribe.has_speech(wav):
                    warnings.append("No speech detected; transcription skipped.")
                else:
                    (tool, lang, segs), ms = _timed(
                        transcribe.transcribe,
                        wav,
                        mode=str(budget["transcribe_model"]),
                        progress=lambda p, d: progress("transcribe", p, d),
                    )
                    if segs:
                        extractions.append(
                            {
                                "kind": "transcript",
                                "tool": tool,
                                "duration_ms": ms,
                                "content": {"language": lang, "segments": segs},
                            }
                        )
                    else:
                        warnings.append("No speech detected; transcription skipped.")
            except WorkerError as e:
                if e.code == "tool_missing":
                    warnings.append(f"Transcription unavailable: {e.message}")
                else:
                    raise

    # 3. frames -------------------------------------------------------------------------------
    frame_budget = int(budget["frames"])
    picked: list[frames_mod.Frame] = []
    if frame_budget > 0:
        progress("frames", 0, "scene detection")
        fdir = out_dir / "frames"
        if dl.kind == "image":
            picked = frames_mod.image_as_frame(dl.path, fdir)
        elif dl.kind == "video":
            (cands, _ms) = _timed(frames_mod.scene_changes, dl.path, max_seconds=limit)
            duration = min(dl.duration_s or 0.0, limit or float("inf"))
            ts = frames_mod.select(cands, budget=frame_budget, duration=duration)
            picked = frames_mod.grab(dl.path, ts, fdir)
        progress("frames", 100, f"{len(picked)} frames")
        for f in picked:
            assets.append(_asset(f.path, "frame", "ffmpeg", frame_ts_s=f.ts))

    # 4. OCR ----------------------------------------------------------------------------------
    if picked:
        progress("ocr", 0, "")
        try:
            (tool, content), ms = _timed(
                ocr.run,
                [(f.ts, f.path) for f in picked],
                progress=lambda p, d: progress("ocr", p, d),
            )
            if content["merged"]:
                extractions.append(
                    {"kind": "ocr", "tool": tool, "duration_ms": ms, "content": content}
                )
        except WorkerError as e:
            if e.code != "tool_missing":
                raise
            warnings.append(f"OCR unavailable: {e.message}")

    # 5. vision -------------------------------------------------------------------------------
    vision_n = min(int(budget["vision_frames"]), len(picked))
    if vision_n > 0 and vision.mode() != "off":
        chosen = _spread(picked, vision_n)
        if vision.mode() == "local":
            progress("vision", 0, "local")
            try:
                (tool, described), ms = _timed(
                    vision.describe_local,
                    [(f.ts, f.path) for f in chosen],
                    progress=lambda p, d: progress("vision", p, d),
                )
                extractions.append(
                    {
                        "kind": "frame_description",
                        "tool": tool,
                        "duration_ms": ms,
                        "content": {"frames": described},
                    }
                )
            except WorkerError as e:
                if e.code != "tool_missing":
                    raise
                warnings.append(f"Local vision unavailable: {e.message}; asking the brain instead.")
                vision_requests.extend({"frame_path": str(f.path), "ts": f.ts} for f in chosen)
        else:
            vision_requests.extend({"frame_path": str(f.path), "ts": f.ts} for f in chosen)
    return result


def _spread(frames: list[frames_mod.Frame], n: int) -> list[frames_mod.Frame]:
    """Evenly spaced subset (keeps first and last)."""
    if n >= len(frames):
        return list(frames)
    if n == 1:
        return [frames[0]]
    step = (len(frames) - 1) / (n - 1)
    idx = sorted({int(round(i * step)) for i in range(n)})
    return [frames[i] for i in idx]
