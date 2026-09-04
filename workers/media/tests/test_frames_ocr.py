from pathlib import Path

from doubletake_media.frames import select
from doubletake_media.ocr import dedupe, levenshtein
from doubletake_media.transcribe import parse_captions


def test_select_keeps_first_last_and_top_scores() -> None:
    cands = [(3.0, 0.4), (9.0, 0.9), (9.2, 0.8), (20.0, 0.5)]
    assert select(cands, budget=4, duration=30.0) == [0.0, 9.0, 20.0, 29.5]
    assert select(cands, budget=1, duration=30.0) == [0.0]
    assert select(cands, budget=0, duration=30.0) == []
    assert select([], budget=12, duration=4.0) == [0.0, 3.5]


def test_dedupe_near_duplicates() -> None:
    assert levenshtein("kitten", "sitting") == 3
    lines = ["Use this skill when vibe coding", "Use this skil when vibe coding", "Subscribe!", "x"]
    assert dedupe(lines) == ["Use this skill when vibe coding", "Subscribe!"]


def test_parse_vtt_rolling_duplicates(tmp_path: Path) -> None:
    vtt = tmp_path / "c.vtt"
    vtt.write_text(
        "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello <c>there</c>\n\n"
        "00:00:02.000 --> 00:00:03.500\nhello there\n\n"
        "00:00:03.500 --> 00:00:05.000\nhello there friend\n\n"
        "00:05.000 --> 00:07.000\nbye\n"
    )
    segs = parse_captions(vtt)
    assert [s["text"] for s in segs] == ["hello there", "hello there friend", "bye"]
    assert segs[0]["start"] == 1.0 and segs[-1]["end"] == 7.0
