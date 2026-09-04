"""OCR over sampled frames: RapidOCR (ONNX) first, Tesseract CLI fallback, then dedupe."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable, Iterable
from pathlib import Path

from .errors import WorkerError

NO_ENGINE = "no OCR engine (uv sync --extra media, or install tesseract)"
MAX_DISTANCE = 0.15  # normalised Levenshtein under which two lines are "the same"


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return len(a or b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def dedupe(lines: Iterable[str]) -> list[str]:
    """Keep the first occurrence of each line; drop near-duplicates (subtitle jitter)."""
    kept: list[str] = []
    for raw in lines:
        line = " ".join(raw.split())
        if len(line) < 2:
            continue
        n = _norm(line)
        dup = False
        for k in kept:
            kn = _norm(k)
            if n == kn:
                dup = True
                break
            longest = max(len(n), len(kn))
            if (
                longest
                and abs(len(n) - len(kn)) / longest <= MAX_DISTANCE
                and levenshtein(n, kn) / longest <= MAX_DISTANCE
            ):
                dup = True
                break
        if not dup:
            kept.append(line)
    return kept


class Engine:
    """Lazily-initialised OCR engine; `read(path) -> list[str]`."""

    def __init__(self) -> None:
        self._rapid = None
        self.tool = "none"
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore[import-not-found]

            self._rapid = RapidOCR()
            self.tool = "rapidocr"
        except Exception:  # noqa: BLE001 - optional dependency
            if shutil.which("tesseract"):
                self.tool = "tesseract"

    @property
    def available(self) -> bool:
        return self.tool != "none"

    def read(self, path: Path) -> list[str]:
        if self._rapid is not None:
            result, _elapse = self._rapid(str(path))
            if not result:
                return []
            # result rows: [box, text, score]
            return [row[1] for row in result if float(row[2]) >= 0.5 and str(row[1]).strip()]
        if self.tool == "tesseract":
            out = subprocess.run(
                ["tesseract", str(path), "stdout", "--psm", "6"],
                capture_output=True,
                text=True,
                check=False,
                timeout=60,
            )
            return [ln for ln in out.stdout.splitlines() if ln.strip()]
        raise WorkerError(
            "tool_missing", "no OCR engine (uv sync --extra media, or install tesseract)"
        )


def run(
    frames: list[tuple[float, Path]], *, progress: Callable[[int, str], None]
) -> tuple[str, dict[str, object]]:
    """Returns (tool, {"frames": [{ts, lines}], "merged": [...]})."""
    eng = Engine()
    if not eng.available:
        raise WorkerError(
            "tool_missing", "no OCR engine (uv sync --extra media, or install tesseract)"
        )
    per_frame: list[dict[str, object]] = []
    all_lines: list[str] = []
    for i, (ts, path) in enumerate(frames):
        lines = dedupe(eng.read(path))
        if lines:
            per_frame.append({"ts": ts, "lines": lines})
            all_lines.extend(lines)
        progress(int((i + 1) * 100 / max(len(frames), 1)), f"{i + 1}/{len(frames)}")
    return eng.tool, {"frames": per_frame, "merged": dedupe(all_lines)}
