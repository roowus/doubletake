"""Frame descriptions.

Default (``DOUBLETAKE_VISION=cloud``): the worker returns ``vision_requests`` and the server asks
the configured brain to describe the frames, so no extra model runs on the laptop.
Opt-in (``DOUBLETAKE_VISION=local``): mlx-vlm (Apple Silicon) runs a small VLM here.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

from .errors import WorkerError

PROMPT = (
    "Describe this video frame for a research assistant: any on-screen text, products, apps or "
    "UI shown, what people are doing (do not try to identify anyone), and the setting. "
    "Two to four sentences, no speculation."
)
LOCAL_MODEL = os.environ.get(
    "DOUBLETAKE_VISION_LOCAL_MODEL", "mlx-community/Qwen2.5-VL-3B-Instruct-4bit"
)


def mode() -> str:
    m = os.environ.get("DOUBLETAKE_VISION", "cloud").strip().lower() or "cloud"
    return m if m in {"cloud", "local", "off"} else "cloud"


def describe_local(
    frames: list[tuple[float, Path]], *, progress: Callable[[int, str], None]
) -> tuple[str, list[dict[str, object]]]:
    """Returns (tool, [{ts, text}]) using mlx-vlm."""
    try:
        from mlx_vlm import generate, load  # type: ignore[import-not-found]
        from mlx_vlm.prompt_utils import apply_chat_template  # type: ignore[import-not-found]
        from mlx_vlm.utils import load_config  # type: ignore[import-not-found]
    except ImportError as e:
        raise WorkerError(
            "tool_missing", "mlx-vlm not installed: uv sync --extra vision-local"
        ) from e
    model, processor = load(LOCAL_MODEL)
    config = load_config(LOCAL_MODEL)
    out: list[dict[str, object]] = []
    for i, (ts, path) in enumerate(frames):
        prompt = apply_chat_template(processor, config, PROMPT, num_images=1)
        text = generate(model, processor, prompt, image=[str(path)], max_tokens=200, verbose=False)
        text = text.text if hasattr(text, "text") else str(text)
        out.append({"ts": ts, "text": text.strip()})
        progress(int((i + 1) * 100 / len(frames)), f"{i + 1}/{len(frames)}")
    return f"mlx-vlm:{LOCAL_MODEL.rsplit('/', 1)[-1]}", out
