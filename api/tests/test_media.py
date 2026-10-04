"""ffprobe and ffmpeg behave the way the transcoder assumes, on every input it accepts."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys

import pytest

from crosstune.jobs.media import (
    MediaError,
    Probe,
    cut,
    encode,
    ffmpeg,
    ffprobe,
    needs_encode,
    playback_bitrate,
    probe,
    remux,
    run_media_tool,
    stream_media_tool,
)

pytestmark = pytest.mark.anyio


async def test_probe_reads_codec_container_bitrate_and_duration(media_fixtures) -> None:
    info = await probe(media_fixtures["m4a"])
    assert info.codec == "aac"
    assert "mp4" in info.format_names
    assert 40_000 <= (info.bit_rate or 0) <= 100_000
    assert 1_900 <= info.duration_ms <= 2_100


async def test_probe_reads_the_channel_count(media_fixtures) -> None:
    assert (await probe(media_fixtures["m4a"])).channels == 1
    assert (await probe(media_fixtures["m4a_stereo"])).channels == 2
    assert (await probe(media_fixtures["wav_surround"])).channels == 6


async def test_probe_rejects_a_file_that_is_not_audio(tmp_path) -> None:
    junk = tmp_path / "junk"
    junk.write_bytes(b"not audio at all")
    with pytest.raises(MediaError):
        await probe(junk)


async def test_needs_encode_only_for_files_outside_the_playback_profile(media_fixtures) -> None:
    assert needs_encode(await probe(media_fixtures["m4a"])) is False
    assert needs_encode(await probe(media_fixtures["m4a_stereo"])) is False
    assert needs_encode(await probe(media_fixtures["m4a_high"])) is True
    assert needs_encode(await probe(media_fixtures["webm"])) is True
    assert needs_encode(await probe(media_fixtures["wav"])) is True
    assert needs_encode(await probe(media_fixtures["mp3"])) is True


@pytest.mark.parametrize(
    ("channels", "bit_rate", "outcome"),
    [
        (1, 192_000, "passthrough"),
        (1, 192_001, "encode"),
        (2, 320_000, "passthrough"),
        (2, 320_001, "encode"),
        (6, 320_000, "encode"),
        (2, None, "encode"),
    ],
)
def test_needs_encode_limits_scale_with_channels(
    channels: int, bit_rate: int | None, outcome: str
) -> None:
    info = Probe(
        codec="aac",
        format_names=frozenset({"mp4"}),
        bit_rate=bit_rate,
        duration_ms=1_000,
        channels=channels,
    )
    assert needs_encode(info) is (outcome == "encode")


async def test_remux_keeps_the_codec_and_writes_a_playable_mp4(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await remux(media_fixtures["m4a"], target)
    info = await probe(target)
    assert info.codec == "aac"
    assert "mp4" in info.format_names
    assert 1_900 <= info.duration_ms <= 2_100


@pytest.mark.parametrize(
    ("channels", "source", "expected"),
    [
        (1, 48_000, 96_000),
        (1, 128_000, 128_000),
        (1, 256_000, 192_000),
        (1, None, 96_000),
        (2, 128_000, 192_000),
        (2, 256_000, 256_000),
        (2, 1_536_000, 320_000),
        (2, None, 192_000),
        (6, 4_608_000, 320_000),
    ],
)
def test_playback_bitrate_follows_the_source_within_floor_and_ceiling(
    channels: int, source: int | None, expected: int
) -> None:
    assert playback_bitrate(channels, source) == expected


@pytest.mark.parametrize("name", ["webm", "mp3"])
async def test_encode_produces_aac_at_the_playback_bitrate(media_fixtures, tmp_path, name) -> None:
    target = tmp_path / "out.m4a"
    await encode(media_fixtures[name], target)
    info = await probe(target)
    assert info.codec == "aac"
    assert "mp4" in info.format_names
    assert info.channels == 1
    assert 70_000 <= (info.bit_rate or 0) <= 130_000
    assert 1_900 <= info.duration_ms <= 2_100


async def test_encode_takes_a_high_bitrate_source_to_the_ceiling(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await encode(media_fixtures["m4a_high"], target)
    info = await probe(target)
    assert 150_000 <= (info.bit_rate or 0) <= 230_000


async def test_encode_keeps_a_lossless_mono_source_mono(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await encode(media_fixtures["wav"], target)
    info = await probe(target)
    assert info.codec == "aac"
    assert info.channels == 1
    assert 1_900 <= info.duration_ms <= 2_100


@pytest.mark.parametrize("name", ["wav_stereo", "wav_surround"])
async def test_encode_gives_stereo_the_stereo_rate(media_fixtures, tmp_path, name) -> None:
    target = tmp_path / "out.m4a"
    await encode(media_fixtures[name], target)
    info = await probe(target)
    assert info.codec == "aac"
    assert info.channels == 2


async def test_encode_takes_a_lossless_stereo_source_to_the_ceiling(
    media_fixtures, tmp_path
) -> None:
    target = tmp_path / "out.m4a"
    await encode(media_fixtures["wav_stereo"], target)
    info = await probe(target)
    # Noise, because the encoder spends far less than its target on a sine. Even on noise
    # it lands a little under 320 kbps.
    assert 260_000 <= (info.bit_rate or 0) <= 340_000


async def test_cut_keeps_a_160k_source_near_160k(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await cut(media_fixtures["m4a_160"], target, start_ms=500, end_ms=1500)
    info = await probe(target)
    assert 140_000 <= (info.bit_rate or 0) <= 190_000


async def test_cut_is_accurate(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await cut(media_fixtures["m4a"], target, start_ms=500, end_ms=1500)
    info = await probe(target)
    assert 970 <= info.duration_ms <= 1030


async def test_cut_keeps_a_stereo_original_stereo(media_fixtures, tmp_path) -> None:
    target = tmp_path / "out.m4a"
    await cut(media_fixtures["wav_stereo"], target, start_ms=500, end_ms=1500)
    info = await probe(target)
    assert info.channels == 2
    assert 970 <= info.duration_ms <= 1030


async def test_probe_selects_the_audio_stream_even_when_it_is_not_first(media_fixtures) -> None:
    # tone_art.m4a carries a video (cover art) track mapped ahead of the audio
    # track: ffprobe lists it as stream 0, the aac stream as stream 1.
    info = await probe(media_fixtures["m4a_art"])
    assert info.codec == "aac"
    assert 1_900 <= info.duration_ms <= 2_100


async def test_run_times_out_and_reaps_the_process(monkeypatch: pytest.MonkeyPatch) -> None:
    # A near-zero timeout forces the kill/wait branch in `run_media_tool`. The suite's
    # filterwarnings=error already fails on an unreaped subprocess, so this test
    # passing at all is the evidence that `process.wait()` after `kill()` is enough.
    monkeypatch.setattr("crosstune.jobs.media.SUBPROCESS_TIMEOUT_SECONDS", 0.2)
    with pytest.raises(MediaError, match="timed out"):
        await run_media_tool("sleep", "5")


async def test_run_kills_and_reaps_the_process_when_cancelled(tmp_path) -> None:
    pid_file = tmp_path / "pid"
    task = asyncio.create_task(run_media_tool("sh", "-c", f"echo $$ > {pid_file}; exec sleep 5"))
    for _ in range(500):
        if pid_file.exists() and pid_file.read_text().strip():
            break
        await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    # A reaped child's pid no longer exists; one left running or unreaped still does.
    with pytest.raises(ProcessLookupError):
        os.kill(int(pid_file.read_text()), 0)


async def test_stream_hands_over_all_of_stdout() -> None:
    chunks: list[bytes] = []
    await stream_media_tool("head", "-c", "200000", "/dev/zero", on_stdout=chunks.append)
    assert b"".join(chunks) == bytes(200_000)


async def test_stream_raises_with_stderr_on_failure() -> None:
    with pytest.raises(MediaError, match="No such file"):
        await stream_media_tool("ls", "/no/such/path", on_stdout=lambda _chunk: None)


async def test_stream_times_out_and_reaps_the_process(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("crosstune.jobs.media.SUBPROCESS_TIMEOUT_SECONDS", 0.2)
    with pytest.raises(MediaError, match="timed out"):
        await stream_media_tool("sleep", "5", on_stdout=lambda _chunk: None)


async def test_probe_rejects_output_that_is_not_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str) -> bytes:
        return b"not json"

    monkeypatch.setattr("crosstune.jobs.media.run_media_tool", fake_run)
    with pytest.raises(MediaError, match="no report"):
        await probe(tmp_path / "whatever")


async def test_probe_rejects_a_report_with_no_audio_stream(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str) -> bytes:
        report = {"streams": [{"codec_type": "video", "codec_name": "mjpeg"}], "format": {}}
        return json.dumps(report).encode()

    monkeypatch.setattr("crosstune.jobs.media.run_media_tool", fake_run)
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

    monkeypatch.setattr("crosstune.jobs.media.run_media_tool", fake_run)
    with pytest.raises(MediaError, match="No duration"):
        await probe(tmp_path / "whatever")


def test_needs_encode_treats_an_unknown_bit_rate_as_needing_encode() -> None:
    info = Probe(
        codec="aac",
        format_names=frozenset({"mp4"}),
        bit_rate=None,
        duration_ms=1_000,
        channels=1,
    )
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
    output = await run_media_tool("env")
    assert b"do-not-leak" not in output


linux_only = pytest.mark.skipif(sys.platform != "linux", reason="the limits are Linux-only")


def test_media_tools_run_under_limits_on_linux(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("crosstune.jobs.media.sys.platform", "linux")
    for argv in (ffmpeg("-i", "x"), ffprobe("x")):
        prefix, tool = argv[: argv.index("--")], argv[argv.index("--") + 1]
        assert prefix[0] == "prlimit"
        assert {flag.split("=")[0] for flag in prefix[1:]} == {"--as", "--cpu", "--fsize"}
        assert tool in {"ffmpeg", "ffprobe"}


@linux_only
async def test_probe_fails_on_a_file_that_needs_more_memory_than_allowed(
    media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("crosstune.jobs.media.MEMORY_LIMIT_BYTES", 16 * 1024 * 1024)
    with pytest.raises(MediaError, match=r"^ffprobe failed"):
        await probe(media_fixtures["m4a"])


@linux_only
def test_hiding_stops_a_child_reading_the_parents_proc_entries() -> None:
    # A fresh interpreter, so the flag never sticks to the test process.
    script = (
        "import os, subprocess\n"
        "from crosstune.jobs.media import hide_from_media_tools\n"
        "def child_reads():\n"
        "    target = f'/proc/{os.getpid()}/environ'\n"
        "    return subprocess.run(['cat', target], capture_output=True).returncode == 0\n"
        "before = child_reads()\n"
        "hide_from_media_tools()\n"
        "print(before, child_reads())\n"
    )
    result = subprocess.run(  # noqa: S603 -- a fixed script run by this interpreter
        [sys.executable, "-c", script], capture_output=True, text=True, check=True
    )
    assert result.stdout.split() == ["True", "False"]


async def test_probe_refuses_audio_in_a_container_outside_the_allowlist(tmp_path) -> None:
    upload = tmp_path / "upload"
    await run_media_tool(
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "au", str(upload)
    )
    with pytest.raises(MediaError):
        await probe(upload)
