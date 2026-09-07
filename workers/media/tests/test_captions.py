from pathlib import Path

from doubletake_media.transcribe import captions_have_speech, parse_captions

VTT_FILLER = """WEBVTT

00:19.640 --> 00:21.040
<u>Music</u>

00:30.280 --> 00:31.680
[Music]

00:32.000 --> 00:33.000
You
"""

VTT_SPEECH = """WEBVTT

00:00.000 --> 00:01.500
[Music]

00:01.500 --> 00:04.000
today we pour the first layer of resin

00:04.000 --> 00:06.000
today we pour the first layer of resin into the mould
"""


def test_filler_only_track_counts_as_no_captions(tmp_path: Path) -> None:
    p = tmp_path / "source.en.vtt"
    p.write_text(VTT_FILLER, encoding="utf-8")
    assert parse_captions(p) == []


def test_speech_track_is_kept_with_rolling_duplicates_collapsed(tmp_path: Path) -> None:
    p = tmp_path / "source.en.vtt"
    p.write_text(VTT_SPEECH, encoding="utf-8")
    segs = parse_captions(p)
    assert captions_have_speech(segs)
    texts = [s["text"] for s in segs]
    assert "today we pour the first layer of resin" in texts
    assert texts[0] == "[Music]"
    assert segs[1]["start"] == 1.5
