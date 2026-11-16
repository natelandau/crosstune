"""ffprobe and ffmpeg behave the way the transcoder assumes, on every input it accepts."""

from __future__ import annotations

import array
import asyncio
import json
import math
import os
import resource
import shutil
import struct
import subprocess
import sys
import time
import tracemalloc
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from crosstune.jobs.media import (
    MAX_RANGE_STALLS,
    MP3_LEAD_MS,
    MediaError,
    Probe,
    StallMap,
    _fill_gap_args,
    _Stall,
    copy_slice,
    cut,
    encode,
    ffmpeg,
    ffprobe,
    needs_encode,
    parse_creation_date,
    parse_iso6709,
    playback_bitrate,
    probe,
    remux,
    run_media_tool,
    scan_stalls,
    stream_media_tool,
)
from tests.helpers import (
    GAPPED_STALL_MS,
    GAPPED_WEBM_GAP_AT_S,
    GAPPED_WEBM_GAP_MS,
    LONG_STALL_MS,
    STEPPED_BACK_MS,
)

if TYPE_CHECKING:
    from pathlib import Path

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


async def test_stream_stops_a_tools_child_that_still_writes_to_its_pipe() -> None:
    def stop(_chunk: bytes) -> None:
        msg = "stop"
        raise MediaError(msg)

    # The background loop holds stdout after the tool itself is killed.
    script = "while :; do echo x; done & exec sleep 30"
    async with asyncio.timeout(10):
        with pytest.raises(MediaError, match="stop"):
            await stream_media_tool("sh", "-c", script, on_stdout=stop)


async def test_stream_stops_a_child_that_outlives_its_tool_and_holds_its_pipe() -> None:
    def stop(_chunk: bytes) -> None:
        # Long enough for the tool itself to exit before the cleanup runs.
        time.sleep(0.3)
        msg = "stop"
        raise MediaError(msg)

    script = "while :; do echo x; done & exit 0"
    async with asyncio.timeout(10):
        with pytest.raises(MediaError, match="stop"):
            await stream_media_tool("sh", "-c", script, on_stdout=stop)


async def test_stream_hands_over_all_of_stdout() -> None:
    chunks: list[bytes] = []
    await stream_media_tool("head", "-c", "200000", "/dev/zero", on_stdout=chunks.append)
    assert b"".join(chunks) == bytes(200_000)


async def test_stream_raises_with_stderr_on_failure() -> None:
    with pytest.raises(MediaError, match="No such file"):
        await stream_media_tool("ls", "/no/such/path", on_stdout=lambda _chunk: None)


# Writes 40 MB to stderr, then a marker, then exits with the code it is given.
NOISY_STDERR = (
    "import sys; write = sys.stderr.buffer.write\n"
    "for _ in range(640): write(b'x' * 65536)\n"
    "write(b'the-end'); sys.exit(int(sys.argv[1]))"
)


async def _run_noisy(runner: str, code: int) -> None:
    argv = (sys.executable, "-c", NOISY_STDERR, str(code))
    if runner == "run":
        await run_media_tool(*argv)
    else:
        await stream_media_tool(*argv, on_stdout=lambda _chunk: None)


@pytest.mark.parametrize("runner", ["run", "stream"])
@pytest.mark.parametrize("code", [0, 3])
async def test_tools_keep_only_the_end_of_a_large_stderr(runner, code) -> None:
    tracemalloc.start()
    try:
        if code == 0:
            await _run_noisy(runner, code)
        else:
            with pytest.raises(MediaError, match=r"the-end$"):
                await _run_noisy(runner, code)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 2_000_000


async def test_run_fails_output_past_its_byte_limit() -> None:
    with pytest.raises(MediaError, match="more than 1000 bytes"):
        await run_media_tool("head", "-c", "200000", "/dev/zero", max_bytes=1000)


async def test_stream_times_out_and_reaps_the_process(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("crosstune.jobs.media.SUBPROCESS_TIMEOUT_SECONDS", 0.2)
    with pytest.raises(MediaError, match="timed out"):
        await stream_media_tool("sleep", "5", on_stdout=lambda _chunk: None)


async def test_probe_rejects_output_that_is_not_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str, **_kwargs: object) -> bytes:
        return b"not json"

    monkeypatch.setattr("crosstune.jobs.media.run_media_tool", fake_run)
    with pytest.raises(MediaError, match="no report"):
        await probe(tmp_path / "whatever")


async def test_probe_rejects_a_report_with_no_audio_stream(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str, **_kwargs: object) -> bytes:
        report = {"streams": [{"codec_type": "video", "codec_name": "mjpeg"}], "format": {}}
        return json.dumps(report).encode()

    monkeypatch.setattr("crosstune.jobs.media.run_media_tool", fake_run)
    with pytest.raises(MediaError, match="No audio stream"):
        await probe(tmp_path / "whatever")


async def test_probe_rejects_a_report_with_no_duration(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_run(*_argv: str, **_kwargs: object) -> bytes:
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


NOW = datetime(2026, 10, 18, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("+36.6612-080.9239+000.000/", (36.6612, -80.9239)),
        ("+36.66-080.92/", (36.66, -80.92)),
        ("-33.8688+151.2093/", (-33.8688, 151.2093)),
        ("garbage", None),
        ("", None),
        ("+3640-08055/", None),
        ("+91.0000-080.9239/", None),
        ("+36.6612-180.5000/", None),
    ],
)
def test_parse_iso6709(value: str, expected: tuple[float, float] | None) -> None:
    assert parse_iso6709(value) == expected


def test_parse_iso6709_keeps_full_precision() -> None:
    assert parse_iso6709("+36.661234567-080.923912345/") == (36.661234567, -80.923912345)


def test_parse_creation_date_prefers_the_apple_tag_and_converts_to_utc() -> None:
    tags = {
        "com.apple.quicktime.creationdate": "2024-06-01T19:30:00-0400",
        "creation_time": "2025-01-01T00:00:00.000000Z",
    }
    assert parse_creation_date(tags, now=NOW) == datetime(2024, 6, 1, 23, 30, tzinfo=UTC)


def test_parse_creation_date_reads_creation_time_alone() -> None:
    tags = {"creation_time": "2024-06-01T23:30:00.000000Z"}
    assert parse_creation_date(tags, now=NOW) == datetime(2024, 6, 1, 23, 30, tzinfo=UTC)


def test_parse_creation_date_matches_keys_ignoring_case() -> None:
    tags = {"CREATION_TIME": "2024-06-01T23:30:00Z"}
    assert parse_creation_date(tags, now=NOW) == datetime(2024, 6, 1, 23, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    "value",
    [
        "2027-01-01T00:00:00Z",
        "1904-01-01T00:00:00Z",
        "1970-01-01T00:00:00Z",
        "garbage",
        "",
    ],
)
def test_parse_creation_date_refuses_unusable_dates(value: str) -> None:
    assert parse_creation_date({"creation_time": value}, now=NOW) is None


def test_parse_creation_date_without_a_tag_is_none() -> None:
    assert parse_creation_date({"encoder": "Lavf"}, now=NOW) is None


async def test_probe_reads_an_apple_location_and_creation_date(tmp_path) -> None:
    upload = tmp_path / "upload"
    await run_media_tool(
        *ffmpeg(
            "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac",
            "-movflags", "use_metadata_tags",
            "-metadata", "com.apple.quicktime.location.ISO6709=+36.6612-080.9239+000.000/",
            "-metadata", "com.apple.quicktime.creationdate=2024-06-01T19:30:00-0400",
            "-f", "mov", str(upload),
        )
    )  # fmt: skip
    info = await probe(upload)
    assert info.location == (36.6612, -80.9239)
    assert info.created_at == datetime(2024, 6, 1, 23, 30, tzinfo=UTC)


async def test_probe_reads_an_mp4_location_and_creation_time(tmp_path) -> None:
    upload = tmp_path / "upload"
    await run_media_tool(
        *ffmpeg(
            "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac",
            "-metadata", "location=+36.6612-080.9239/",
            "-metadata", "creation_time=2024-06-01T23:30:00Z",
            "-f", "mp4", str(upload),
        )
    )  # fmt: skip
    info = await probe(upload)
    assert info.location == (36.6612, -80.9239)
    assert info.created_at == datetime(2024, 6, 1, 23, 30, tzinfo=UTC)


async def test_probe_of_a_file_without_tags_has_no_location_or_date(media_fixtures) -> None:
    info = await probe(media_fixtures["wav"])
    assert info.location is None
    assert info.created_at is None


SLICE_RATE = 44_100
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
SLICE_ENCODERS = {
    "m4a": ["-c:a", "aac", "-b:a", "128k", "-f", "mp4"],
    "mp3": ["-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3"],
    "wav": ["-c:a", "pcm_s16le", "-f", "wav"],
}


@pytest.fixture(scope="module")
def noise_sources(tmp_path_factory) -> dict[str, Path]:
    """Four seconds of 44.1 kHz noise per format, so a decoded position matches only once."""
    folder = tmp_path_factory.mktemp("noise")
    paths = {}
    for name, args in SLICE_ENCODERS.items():
        paths[name] = folder / f"noise.{name}"
        subprocess.run(  # noqa: S603
            [
                FFMPEG,
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"anoisesrc=duration=4:amplitude=0.3:sample_rate={SLICE_RATE}:seed=1",
                "-ac",
                "1",
                *args,
                str(paths[name]),
            ],
            check=True,
        )
    return paths


def playable_args(path: Path) -> list[str]:
    """Stop a decode where an MP4's edit list ends the audio, as a player does.

    Some ffmpeg releases decode an AAC file's last frame whole, padding included.
    """
    report = json.loads(
        subprocess.run(  # noqa: S603
            [
                shutil.which("ffprobe") or "ffprobe",
                "-v", "error", "-select_streams", "a:0", "-show_entries",
                "format=format_name:stream=duration", "-of", "json", str(path),
            ],
            check=True,
            capture_output=True,
        ).stdout
    )  # fmt: skip
    if "mp4" not in report["format"]["format_name"].split(","):
        return []
    return ["-t", report["streams"][0]["duration"]]


def decode_pcm(path: Path) -> bytes:
    return subprocess.run(  # noqa: S603
        [
            FFMPEG,
            "-v",
            "error",
            "-i",
            str(path),
            *playable_args(path),
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "44100",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout


# 1280 ms is exactly 49 MP3 frames of 1152 samples at 44.1 kHz, so the cut falls on a packet
# boundary.
@pytest.mark.parametrize("name", ["m4a", "mp3", "wav"])
@pytest.mark.parametrize("start_ms", [0, 1000, 1100, 1280, 1500, 2200, 3333])
async def test_copy_slice_decodes_like_the_original_from_the_returned_start(
    noise_sources, tmp_path, name, start_ms
) -> None:
    end_ms = start_ms + 600
    target = tmp_path / f"slice.{name}"
    returned = (await copy_slice(noise_sources[name], target, start_ms, end_ms)).start_ms

    assert start_ms - 100 < returned <= start_ms
    original, sliced = decode_pcm(noise_sources[name]), decode_pcm(target)
    # Past the first frames, which a decoder starting mid-stream cannot reproduce.
    probe_at = 20_000
    found = original.find(sliced[2 * probe_at : 2 * (probe_at + 64)])
    assert found != -1
    assert abs((found // 2 - probe_at) * 1000 / SLICE_RATE - returned) <= 1
    assert returned + len(sliced) / 2 / SLICE_RATE * 1000 >= end_ms - 1


def _aligned_at(original: bytes, sliced: bytes, probe_at: int) -> float:
    """Where, in ms on the original's decoded timeline, the slice's decode starts."""
    found = original.find(sliced[2 * probe_at : 2 * (probe_at + 64)])
    assert found != -1
    assert original.find(sliced[2 * probe_at : 2 * (probe_at + 64)], found + 1) == -1
    return (found // 2 - probe_at) * 1000 / SLICE_RATE


async def test_copy_slice_of_an_mp3_aligns_where_it_starts_in_silence(tmp_path) -> None:
    source = tmp_path / "gap.mp3"
    await run_media_tool(
        *ffmpeg(
            "-v", "error",
            "-f", "lavfi", "-i", f"anoisesrc=d=1.5:a=0.3:r={SLICE_RATE}:seed=1",
            "-f", "lavfi", "-i", f"anullsrc=r={SLICE_RATE}:cl=mono:d=1.5",
            "-f", "lavfi", "-i", f"anoisesrc=d=1.5:a=0.3:r={SLICE_RATE}:seed=2",
            "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", "-ac", "1",
            *SLICE_ENCODERS["mp3"], str(source),
        )
    )  # fmt: skip
    target = tmp_path / "slice.mp3"
    # The first second of the slice is silence, which matches anywhere in the gap.
    returned = (await copy_slice(source, target, 1_600, 3_800)).start_ms

    original, sliced = decode_pcm(source), decode_pcm(target)
    noise_at = round((3_000 - returned + 200) * SLICE_RATE / 1000)
    assert abs(_aligned_at(original, sliced, noise_at) - returned) <= 1


async def test_copy_slice_of_an_mp3_needs_no_sample_rate_from_its_probe(
    noise_sources, tmp_path
) -> None:
    info = Probe(
        codec="mp3", format_names=frozenset({"mp3"}), bit_rate=None, duration_ms=4_000, channels=1
    )
    target = tmp_path / "slice.mp3"
    returned = (await copy_slice(noise_sources["mp3"], target, 1_000, 1_600, info=info)).start_ms
    original, sliced = decode_pcm(noise_sources["mp3"]), decode_pcm(target)
    assert abs(_aligned_at(original, sliced, 20_000) - returned) <= 1


async def test_copy_slice_of_an_all_silent_mp3_starts_where_the_copy_does(tmp_path) -> None:
    source = tmp_path / "silence.mp3"
    await run_media_tool(
        *ffmpeg(
            "-v", "error", "-f", "lavfi", "-i", f"anullsrc=r={SLICE_RATE}:cl=mono:d=3",
            *SLICE_ENCODERS["mp3"], str(source),
        )
    )  # fmt: skip
    returned = (await copy_slice(source, tmp_path / "slice.mp3", 1_000, 2_000)).start_ms
    assert returned == 1_000 - MP3_LEAD_MS


async def test_copy_slice_of_an_mp4_with_a_video_stream_copies_the_audio(
    noise_sources, tmp_path
) -> None:
    source = tmp_path / "video.mp4"
    await run_media_tool(
        *ffmpeg(
            "-v", "error",
            "-f", "lavfi", "-i", "color=c=black:s=64x64:r=1:d=4",
            "-i", str(noise_sources["m4a"]),
            "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-g", "4", "-c:a", "copy",
            "-f", "mp4", str(source),
        )
    )  # fmt: skip
    target = tmp_path / "slice.m4a"
    returned = (await copy_slice(source, target, 1_500, 2_500)).start_ms

    info = await probe(target)
    assert info.codec == "aac"
    assert 1_400 < returned <= 1_500
    assert abs(_aligned_at(decode_pcm(source), decode_pcm(target), 20_000) - returned) <= 1


# A seek costs the media tools a fraction of a CPU second; decoding an hour-long file from its
# start costs several. CPU time, unlike elapsed time, stays the same on a loaded machine.
SEEK_CPU_BUDGET_SECONDS = 1


def children_cpu_seconds() -> float:
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    return usage.ru_utime + usage.ru_stime


async def test_copy_slice_of_long_m4a_is_fast(long_m4a, tmp_path) -> None:
    began = children_cpu_seconds()
    start = (await copy_slice(long_m4a, tmp_path / "slice.m4a", 1_800_000, 2_400_000)).start_ms
    assert children_cpu_seconds() - began < SEEK_CPU_BUDGET_SECONDS
    assert 1_800_000 - 100 < start <= 1_800_000
    assert (await probe(tmp_path / "slice.m4a")).duration_ms >= 2_400_000 - start - 30


async def test_copy_slice_of_webm_reencodes(media_fixtures, tmp_path) -> None:
    target = tmp_path / "slice.m4a"
    assert (await copy_slice(media_fixtures["webm"], target, 500, 1500)).start_ms == 500
    info = await probe(target)
    assert info.codec == "aac"
    assert 900 <= info.duration_ms <= 1_100


CUT_RATE = 8_000
CUT_WINDOW = 4_000
CUT_LAG = 80


def decode_low_rate(path: Path) -> array.array:
    pcm = subprocess.run(  # noqa: S603
        [
            FFMPEG,
            "-v",
            "error",
            "-i",
            str(path),
            *playable_args(path),
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            str(CUT_RATE),
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    samples = array.array("h")
    samples.frombytes(pcm)
    return samples


def best_lag(reference: array.array, heard: array.array, ref_at: int, heard_at: int) -> int:
    """Find how many samples `reference` runs ahead of `heard` where both are the same audio."""
    window = heard[heard_at : heard_at + CUT_WINDOW]

    def score(lag: int) -> int:
        start = ref_at + lag
        return sum(
            a * b for a, b in zip(reference[start : start + CUT_WINDOW], window, strict=False)
        )

    return max(range(-CUT_LAG, CUT_LAG + 1), key=score)


@pytest.mark.parametrize("name", ["m4a", "mp3", "wav"])
@pytest.mark.parametrize("start_ms", [200, 1000, 1500, 2000, 2200])
async def test_cut_lands_on_the_decoded_timeline(noise_sources, tmp_path, name, start_ms) -> None:
    end_ms = start_ms + 1500
    target = tmp_path / "cut.m4a"
    await cut(noise_sources[name], target, start_ms, end_ms)

    original, cut_audio = decode_low_rate(noise_sources[name]), decode_low_rate(target)
    ms = CUT_RATE // 1000
    # 1 ms is eight samples; the start window and a window ending at end_ms both align.
    assert abs(best_lag(original, cut_audio, start_ms * ms + 500, 500)) <= ms
    tail = (end_ms - start_ms) * ms - CUT_WINDOW - 500
    assert abs(best_lag(original, cut_audio, start_ms * ms + tail, tail)) <= ms
    assert abs(len(cut_audio) / ms - (end_ms - start_ms)) <= 1


async def test_cut_deep_in_a_long_file_is_fast(long_m4a, tmp_path) -> None:
    began = children_cpu_seconds()
    await cut(long_m4a, tmp_path / "cut.m4a", 3_500_000, 3_510_000)
    assert children_cpu_seconds() - began < SEEK_CPU_BUDGET_SECONDS
    assert 9_900 <= (await probe(tmp_path / "cut.m4a")).duration_ms <= 10_100


def decoded_ms(path: Path) -> float:
    return len(decode_pcm(path)) / 2 / SLICE_RATE * 1000


@pytest.mark.parametrize(
    ("start_ms", "end_ms"), [(0, 1843), (200, 900), (1000, 2000), (1843, 3781), (3000, 4000)]
)
async def test_cut_of_a_webm_with_a_timestamp_gap_covers_its_range(
    gapped_webm, tmp_path, start_ms, end_ms
) -> None:
    target = tmp_path / "cut.m4a"
    await cut(gapped_webm, target, start_ms, end_ms)
    assert abs(decoded_ms(target) - (end_ms - start_ms)) <= 1


@pytest.mark.parametrize(
    ("start_ms", "end_ms"), [(0, 1843), (200, 900), (1100, 2000), (1843, 3781), (3000, 4000)]
)
async def test_copy_slice_of_a_webm_with_a_timestamp_gap_aligns_and_covers(
    gapped_webm, tmp_path, start_ms, end_ms
) -> None:
    target = tmp_path / "slice.m4a"
    assert (await copy_slice(gapped_webm, target, start_ms, end_ms)).start_ms == start_ms
    assert abs(decoded_ms(target) - (end_ms - start_ms)) <= 1

    # The gap holds no samples, so after it the sample timeline trails the timestamps.
    original, sliced = decode_low_rate(gapped_webm), decode_low_rate(target)
    ms = CUT_RATE // 1000
    skipped = GAPPED_WEBM_GAP_MS if start_ms > GAPPED_WEBM_GAP_AT_S * 1000 else 0
    ref_at = (start_ms - skipped) * ms + 500
    assert abs(best_lag(original, sliced, ref_at, 500)) <= ms


async def test_encode_and_cut_of_a_gapped_webm_share_a_timeline(gapped_webm, tmp_path) -> None:
    whole, part = tmp_path / "whole.m4a", tmp_path / "part.m4a"
    await encode(gapped_webm, whole)
    await cut(gapped_webm, part, 3000, 4000)

    ms = CUT_RATE // 1000
    # The silence sits in both, so 3000 ms of the encode is 3000 ms of the cut's source.
    assert abs(decoded_ms(whole) - (6000 + GAPPED_WEBM_GAP_MS)) <= 30
    lag = best_lag(decode_low_rate(whole), decode_low_rate(part), 3000 * ms + 500, 500)
    assert abs(lag) <= ms


async def test_cut_of_a_webm_stepping_back_keeps_every_sample(stepped_back_webm, tmp_path) -> None:
    target = tmp_path / "cut.m4a"
    await cut(stepped_back_webm, target, 0, 7000)
    assert abs(decoded_ms(target) - 6000) <= 25
    await encode(stepped_back_webm, target)
    assert abs(decoded_ms(target) - 6000) <= 25
    assert STEPPED_BACK_MS < 20


async def test_cut_of_a_drifting_webm_keeps_every_sample(drifting_webm, tmp_path) -> None:
    target = tmp_path / "cut.m4a"
    plain = tmp_path / "plain.m4a"
    await cut(drifting_webm, target, 0, 59_000)
    # The same range with no filter: whatever the timestamps select, nothing is added or removed.
    await run_media_tool(
        *ffmpeg(
            "-v", "error", "-y", "-ss", "0ms", "-to", "59000ms", "-i", str(drifting_webm),
            "-vn", "-c:a", "aac", "-b:a", "64k", "-f", "mp4", str(plain),
        )
    )  # fmt: skip
    assert abs(decoded_ms(target) - decoded_ms(plain)) <= 25


@pytest.mark.parametrize("name", ["m4a", "mp3", "wav"])
async def test_gapless_sources_are_cut_and_encoded_unfiltered(
    media_fixtures, tmp_path, name
) -> None:
    source = media_fixtures[name]
    info = await probe(source)
    assert await _fill_gap_args(source, info, to_ms=1500) == ()


async def test_a_clean_webm_gets_no_gap_filter(plain_webm) -> None:
    assert await _fill_gap_args(plain_webm, await probe(plain_webm)) == ()


def _stalls(count: int) -> StallMap:
    step = 0.9 / count
    return StallMap(tuple(_Stall(i * step, i * step, i * step + 0.03) for i in range(count)))


async def test_cut_fills_as_many_stalls_as_a_range_may_hold(plain_webm, tmp_path) -> None:
    await cut(plain_webm, tmp_path / "cut.m4a", 0, 1000, stalls=_stalls(MAX_RANGE_STALLS))
    with pytest.raises(MediaError, match="timestamp stalls"):
        await cut(plain_webm, tmp_path / "cut.m4a", 0, 1000, stalls=_stalls(MAX_RANGE_STALLS + 1))


STALL_START, STALL_END = GAPPED_STALL_MS


@pytest.mark.parametrize("webm", ["gapped_webm", "offset_gapped_webm"])
@pytest.mark.parametrize("start_ms", [STALL_START + 6, 1050, 1080, STALL_END - 3])
async def test_cut_starting_inside_a_stall_keeps_its_length_and_audio(
    request, tmp_path, webm, start_ms
) -> None:
    source = request.getfixturevalue(webm)
    end_ms = 2000
    target = tmp_path / "cut.m4a"
    await cut(source, target, start_ms, end_ms)
    assert abs(decoded_ms(target) - (end_ms - start_ms)) <= 1

    # The audio resumes at the stall's end, where the sample timeline trails by the stall.
    ms = CUT_RATE // 1000
    original, cut_audio = decode_low_rate(source), decode_low_rate(target)
    resumed = (STALL_END - GAPPED_WEBM_GAP_MS + 300) * ms
    heard_at = (STALL_END + 300 - start_ms) * ms
    assert abs(best_lag(original, cut_audio, resumed, heard_at)) <= ms


@pytest.mark.parametrize("webm", ["gapped_webm", "offset_gapped_webm"])
@pytest.mark.parametrize("end_ms", [STALL_START + 6, 1050, 1080, STALL_END - 3, STALL_END])
async def test_cut_ending_inside_a_stall_keeps_its_length_and_audio(
    request, tmp_path, webm, end_ms
) -> None:
    source = request.getfixturevalue(webm)
    start_ms = 500
    target = tmp_path / "cut.m4a"
    await cut(source, target, start_ms, end_ms)
    assert abs(decoded_ms(target) - (end_ms - start_ms)) <= 1

    ms = CUT_RATE // 1000
    original, cut_audio = decode_low_rate(source), decode_low_rate(target)
    assert abs(best_lag(original, cut_audio, (start_ms + 100) * ms, 100 * ms)) <= ms


LONG_STALL_START, LONG_STALL_END = LONG_STALL_MS


def rms(samples: array.array) -> float:
    return (sum(sample * sample for sample in samples) / len(samples)) ** 0.5


@pytest.mark.parametrize(
    "end_ms", [LONG_STALL_START + 1000, LONG_STALL_START + 2500, LONG_STALL_END]
)
async def test_cut_ending_far_inside_a_long_stall_keeps_its_length(
    long_stalled_webm, tmp_path, end_ms
) -> None:
    start_ms = 500
    target = tmp_path / "cut.m4a"
    await cut(long_stalled_webm, target, start_ms, end_ms)
    assert abs(decoded_ms(target) - (end_ms - start_ms)) <= 1

    ms = CUT_RATE // 1000
    original, cut_audio = decode_low_rate(long_stalled_webm), decode_low_rate(target)
    assert abs(best_lag(original, cut_audio, (start_ms + 100) * ms, 100 * ms)) <= ms
    stalled = cut_audio[(LONG_STALL_START - start_ms + 30) * ms :]
    assert rms(stalled) < rms(original) / 50


@pytest.mark.parametrize(
    ("webm", "start_ms", "end_ms"),
    [
        ("gapped_webm", 1050, 1080),
        ("gapped_webm", 1050, STALL_END),
        ("gapped_webm", STALL_START, STALL_END),
        ("long_stalled_webm", 1500, 3000),
    ],
)
async def test_cut_wholly_inside_a_stall_is_silence_of_its_length(
    request, tmp_path, webm, start_ms, end_ms
) -> None:
    target = tmp_path / "cut.m4a"
    source = request.getfixturevalue(webm)
    await cut(source, target, start_ms, end_ms)
    assert abs(decoded_ms(target) - (end_ms - start_ms)) <= 1
    # A cut on a packet's end keeps a fraction of a millisecond of it, which the AAC
    # encoder smears at a low level across its frame, so this measures level, not peaks.
    edge = 2 * CUT_RATE // 1000
    assert rms(decode_low_rate(target)[edge:]) < rms(decode_low_rate(source)) / 50


PCM_PACKET_MS = 100


def _ebml(element_id: int, payload: bytes) -> bytes:
    """One EBML element, its size always written in eight bytes."""
    id_bytes = element_id.to_bytes((element_id.bit_length() + 7) // 8, "big")
    return id_bytes + (1 << 56 | len(payload)).to_bytes(8, "big") + payload


def _ebml_uint(element_id: int, value: int) -> bytes:
    return _ebml(element_id, value.to_bytes(8, "big"))


def _pcm_mkv(path: Path, stamps_ms: list[int]) -> Path:
    """Write a mono 8 kHz tone as PCM in Matroska, one 100 ms packet at each stamp in order."""
    samples = CUT_RATE * PCM_PACKET_MS // 1000
    tone = array.array(
        "h", (round(8000 * math.sin(2 * math.pi * 440 * i / CUT_RATE)) for i in range(samples))
    )
    if sys.byteorder == "big":
        tone.byteswap()
    audio = _ebml(0xE1, _ebml(0xB5, struct.pack(">d", CUT_RATE)) + _ebml_uint(0x9F, 1))
    track = _ebml(
        0xAE,
        _ebml_uint(0xD7, 1)
        + _ebml_uint(0x73C5, 1)
        + _ebml_uint(0x83, 2)
        + _ebml(0x86, b"A_PCM/INT/LIT")
        + _ebml_uint(0x23E383, PCM_PACKET_MS * 1_000_000)
        + audio
        + _ebml_uint(0x6264, 16),
    )
    length_ms = max(stamps_ms) + PCM_PACKET_MS
    info = _ebml(
        0x1549A966, _ebml_uint(0x2AD7B1, 1_000_000) + _ebml(0x4489, struct.pack(">d", length_ms))
    )
    blocks = b"".join(
        _ebml(0xA3, b"\x81" + struct.pack(">hB", at, 0x80) + tone.tobytes()) for at in stamps_ms
    )
    segment = info + _ebml(0x1654AE6B, track) + _ebml(0x1F43B675, _ebml_uint(0xE7, 0) + blocks)
    path.write_bytes(_ebml(0x1A45DFA3, _ebml(0x4282, b"matroska")) + _ebml(0x18538067, segment))
    return path


REPLAYED_STALL_MS = (100, 500)
HOLED_STALL_MS = (500, 5500)


@pytest.fixture(scope="module")
def replayed_mkv(tmp_path_factory) -> Path:
    """Matroska whose stamps alternate between 0 and 500 ms, after one real 400 ms stall."""
    return _pcm_mkv(tmp_path_factory.mktemp("replayed") / "replayed.mkv", [0, 500] * 20)


@pytest.fixture(scope="module")
def holed_mkv(tmp_path_factory) -> Path:
    """Matroska with half a second of audio, a 5 s stall, then another half second."""
    stamps = [*range(0, 500, PCM_PACKET_MS), *range(5500, 6000, PCM_PACKET_MS)]
    return _pcm_mkv(tmp_path_factory.mktemp("holed") / "holed.mkv", stamps)


@pytest.mark.parametrize("slicer", [cut, copy_slice])
@pytest.mark.parametrize(("mkv", "end_ms"), [("replayed_mkv", 1000), ("holed_mkv", 6000)])
async def test_cut_and_slice_of_a_matroska_cover_exactly_their_range(
    request, tmp_path, slicer, mkv, end_ms
) -> None:
    source = request.getfixturevalue(mkv)
    target = tmp_path / "cut.m4a"
    await slicer(source, target, 0, end_ms)
    assert abs(decoded_ms(target) - end_ms) <= 1


async def test_cut_of_a_matroska_fills_its_stall_with_silence(holed_mkv, tmp_path) -> None:
    target = tmp_path / "cut.m4a"
    await cut(holed_mkv, target, 0, 6000)
    ms = CUT_RATE // 1000
    stall_start, stall_end = HOLED_STALL_MS
    audio = decode_low_rate(target)
    heard = audio[100 * ms : (stall_start - 50) * ms]
    assert rms(audio[(stall_start + 50) * ms : (stall_end - 50) * ms]) < rms(heard) / 50
    assert rms(audio[(stall_end + 50) * ms : (stall_end + 400) * ms]) > rms(heard) / 2


@pytest.mark.parametrize(
    ("fixture", "stall_ms"),
    [
        ("gapped_webm", GAPPED_STALL_MS),
        ("long_stalled_webm", LONG_STALL_MS),
        ("plain_webm", None),
        ("holed_mkv", HOLED_STALL_MS),
        # Stamps that step back and forward again over audio already read are no stall.
        ("replayed_mkv", REPLAYED_STALL_MS),
    ],
)
async def test_scan_stalls_finds_each_stall(request, fixture, stall_ms) -> None:
    source = request.getfixturevalue(fixture)
    stalls = (await scan_stalls(source, await probe(source))).stalls
    if stall_ms is None:
        assert stalls == ()
        return
    [stall] = stalls
    assert stall.earlier_end is not None
    assert (round(stall.earlier_end * 1000), round(stall.pts * 1000)) == stall_ms


@pytest.mark.parametrize(
    ("limit", "value", "message"),
    [("MAX_SCANNED_PACKETS", 100, "packets"), ("MAX_SCANNED_STALLS", 0, "stalls")],
)
async def test_scan_stalls_fails_a_file_past_its_limits(
    gapped_webm, monkeypatch: pytest.MonkeyPatch, limit, value, message
) -> None:
    monkeypatch.setattr(f"crosstune.jobs.media.{limit}", value)
    with pytest.raises(MediaError, match=message):
        await scan_stalls(gapped_webm, await probe(gapped_webm))


@pytest.fixture(scope="module")
def many_packet_webm(tmp_path_factory) -> Path:
    """A minute of Opus in WebM in 2.5 ms frames: 24,000 packets."""
    path = tmp_path_factory.mktemp("many-packets") / "many.webm"
    subprocess.run(  # noqa: S603
        [
            FFMPEG, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=60",
            "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "6k",
            "-frame_duration", "2.5", "-f", "webm", str(path),
        ],
        check=True,
    )  # fmt: skip
    return path


async def test_scan_stalls_holds_memory_flat_whatever_the_packet_count(many_packet_webm) -> None:
    info = await probe(many_packet_webm)
    tracemalloc.start()
    try:
        assert (await scan_stalls(many_packet_webm, info)).stalls == ()
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    # The report held whole takes more than this; a streamed read holds a chunk at a time.
    assert peak < 1_000_000
