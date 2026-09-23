"""ffprobe and ffmpeg behave the way the transcoder assumes, on every input it accepts."""

from __future__ import annotations

import json

import pytest

from crosstune.jobs.media import (
    MediaError,
    Probe,
    _run,
    encode,
    needs_encode,
    probe,
    remux,
)

pytestmark = pytest.mark.anyio


async def test_probe_reads_codec_container_bitrate_and_duration(media_fixtures) -> None:
    info = await probe(media_fixtures["m4a"])
    assert info.codec == "aac"
    assert "mp4" in info.format_names
    assert 40_000 <= (info.bit_rate or 0) <= 100_000
    assert 1_900 <= info.duration_ms <= 2_100


async def test_probe_rejects_a_file_that_is_not_audio(tmp_path) -> None:
    junk = tmp_path / "junk"
    junk.write_bytes(b"not audio at all")
    with pytest.raises(MediaError):
        await probe(junk)


async def test_needs_encode_only_for_files_outside_the_playback_profile(media_fixtures) -> None:
    assert needs_encode(await probe(media_fixtures["m4a"])) is False
    assert needs_encode(await probe(media_fixtures["m4a_high"])) is True
    assert needs_encode(await probe(media_fixtures["webm"])) is True
    assert needs_encode(await probe(media_fixtures["wav"])) is True
    assert needs_encode(await probe(media_fixtures["mp3"])) is True


async def test_remux_keeps_the_codec_and_writes_a_playable_mp4(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await remux(media_fixtures["m4a"], target)
    info = await probe(target)
    assert info.codec == "aac"
    assert "mp4" in info.format_names
    assert 1_900 <= info.duration_ms <= 2_100


@pytest.mark.parametrize("name", ["webm", "wav", "mp3", "m4a_high"])
async def test_encode_produces_aac_at_the_playback_bitrate(media_fixtures, tmp_path, name) -> None:
    target = tmp_path / "out.m4a"
    await encode(media_fixtures[name], target)
    info = await probe(target)
    assert info.codec == "aac"
    assert "mp4" in info.format_names
    assert 70_000 <= (info.bit_rate or 0) <= 130_000
    assert 1_900 <= info.duration_ms <= 2_100


async def test_probe_selects_the_audio_stream_even_when_it_is_not_first(media_fixtures) -> None:
    # tone_art.m4a carries a video (cover art) track mapped ahead of the audio
    # track: ffprobe lists it as stream 0, the aac stream as stream 1.
    info = await probe(media_fixtures["m4a_art"])
    assert info.codec == "aac"
    assert 1_900 <= info.duration_ms <= 2_100


async def test_run_times_out_and_reaps_the_process(monkeypatch: pytest.MonkeyPatch) -> None:
    # A near-zero timeout forces the kill/wait branch in `_run`. The suite's
    # filterwarnings=error already fails on an unreaped subprocess, so this test
    # passing at all is the evidence that `process.wait()` after `kill()` is enough.
    monkeypatch.setattr("crosstune.jobs.media.SUBPROCESS_TIMEOUT_SECONDS", 0.2)
    with pytest.raises(MediaError, match="timed out"):
        await _run("sleep", "5")


async def test_probe_rejects_output_that_is_not_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str) -> bytes:
        return b"not json"

    monkeypatch.setattr("crosstune.jobs.media._run", fake_run)
    with pytest.raises(MediaError, match="no report"):
        await probe(tmp_path / "whatever")


async def test_probe_rejects_a_report_with_no_audio_stream(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str) -> bytes:
        report = {"streams": [{"codec_type": "video", "codec_name": "mjpeg"}], "format": {}}
        return json.dumps(report).encode()

    monkeypatch.setattr("crosstune.jobs.media._run", fake_run)
    with pytest.raises(MediaError, match="No audio stream"):
        await probe(tmp_path / "whatever")


async def test_probe_rejects_a_report_with_no_duration(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str) -> bytes:
        report = {
            "streams": [{"codec_type": "audio", "codec_name": "aac"}],
            "format": {"format_name": "mp4"},
        }
        return json.dumps(report).encode()

    monkeypatch.setattr("crosstune.jobs.media._run", fake_run)
    with pytest.raises(MediaError, match="No duration"):
        await probe(tmp_path / "whatever")


def test_needs_encode_treats_an_unknown_bit_rate_as_needing_encode() -> None:
    info = Probe(codec="aac", format_names=frozenset({"mp4"}), bit_rate=None, duration_ms=1_000)
    assert needs_encode(info) is True


async def test_probe_refuses_a_playlist_that_reads_another_local_file(
    media_fixtures, tmp_path
) -> None:
    playlist = tmp_path / "upload"
    playlist.write_text(
        f"#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n{media_fixtures['wav']}\n#EXT-X-ENDLIST\n"
    )
    with pytest.raises(MediaError):
        await probe(playlist)


async def test_encode_refuses_a_concat_list_that_reads_another_local_file(
    media_fixtures, tmp_path
) -> None:
    listing = tmp_path / "upload"
    listing.write_text(f"ffconcat version 1.0\nfile '{media_fixtures['wav']}'\n")
    with pytest.raises(MediaError):
        await encode(listing, tmp_path / "playback.m4a")


async def test_run_hands_the_tools_none_of_the_apis_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CROSSTUNE_STORAGE_SECRET_ACCESS_KEY", "do-not-leak")
    output = await _run("env")
    assert b"do-not-leak" not in output


async def test_probe_refuses_audio_in_a_container_outside_the_allowlist(tmp_path) -> None:
    upload = tmp_path / "upload"
    await _run(
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "au", str(upload)
    )
    with pytest.raises(MediaError):
        await probe(upload)
