"""Error codes surfaced to the server (docs/MEDIA-PIPELINE.md, "Failure modes")."""

from __future__ import annotations


class WorkerError(Exception):
    """A failure the server can show in chat. `retryable` drives the auto-retry."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable

    def to_json(self) -> dict[str, object]:
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


PRIVATE_MARKERS = (
    "private video",
    "login required",
    "requested content is not available",
    "rate-limit reached",
    "this video is unavailable",
    "video unavailable",
    "has been removed",
    "is not available",
    "sign in to confirm",
    "account has been terminated",
    "members-only",
    "age-restricted",
    "restricted video",
    "unable to extract shared data",
    "you need to log in",
)
NETWORK_MARKERS = (
    "unable to download webpage",
    "connection reset",
    "timed out",
    "temporary failure in name resolution",
    "http error 5",
    "http error 429",
    "read error",
    "remote end closed",
)


def classify_ytdlp_failure(stderr: str) -> WorkerError:
    """Map yt-dlp's stderr to a stable code. Keeps the last ERROR line for the chat."""
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    errors = [ln for ln in lines if ln.lower().startswith("error")]
    detail = (errors[-1] if errors else (lines[-1] if lines else "yt-dlp failed")).removeprefix(
        "ERROR: "
    )
    low = detail.lower()
    if any(m in low for m in PRIVATE_MARKERS):
        return WorkerError(
            "private_or_removed",
            f"{detail} (set DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER to use a logged-in browser)",
        )
    if any(m in low for m in NETWORK_MARKERS):
        return WorkerError("download_failed", detail, retryable=True)
    return WorkerError("download_failed", detail)
