#!/usr/bin/env python3
"""Fails if any relative Markdown link in the repo points at a missing file.

Run by CI (docs job) and by hand: python3 scripts/check-links.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)")
SKIP_DIRS = {"node_modules", ".git", "dist", ".venv", "build"}


def main() -> int:
    bad: list[str] = []
    for md in ROOT.rglob("*.md"):
        if any(part in SKIP_DIRS for part in md.parts):
            continue
        for target in LINK.findall(md.read_text(encoding="utf-8")):
            if "://" in target or target.startswith("mailto:"):
                continue
            if not (md.parent / target).exists():
                bad.append(f"{md.relative_to(ROOT)} -> {target}")
    for b in bad:
        print(f"broken link: {b}")
    print(f"{len(bad)} broken link(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
