"""ffprobe and ffmpeg as subprocesses. Nothing here touches the database or the bucket."""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, NamedTuple

from crosstune.storage.store import PLAYBACK_MIME

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable, Mapping
    from pathlib import Path

MAX_PLAYBACK_CHANNELS = 2
# At high rates ffmpeg's native AAC encoder widens its own lowpass to 22 kHz and then
# spends well under its target, about 240 kbps when asked for stereo at 320. Holding the
# band at 20 kHz, the edge of hearing, lets it spend what it is given. Below this rate per
# channel the encoder keeps its own narrower band, which suits fewer bits.
WIDE_BAND_BITRATE_PER_CHANNEL = 128_000
LOWPASS_HZ = 20_000
SUBPROCESS_TIMEOUT_SECONDS = 300.0
STREAM_CHUNK_BYTES = 64 * 1024
# Every file these tools open is an upload someone else chose. Reading only local files,
# and only through the demuxers of the audio types an upload may declare, keeps a
# playlist or concat list from pulling in any other file or URL.
INPUT_GUARD = (
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    "mov,mp4,m4a,matroska,webm,ogg,wav,mp3,flac,aiff,aac",
)
# A file that makes a decoder balloon fails its job instead of exhausting the API's
# container. Linux enforces no resident-memory limit, so this caps address space, which
# MALLOC_ARENA_MAX and -filter_threads hold near 400 MB whatever the host's core count.
MEMORY_LIMIT_BYTES = 1 << 30
FILE_LIMIT_BYTES = 1 << 30
_PR_SET_DUMPABLE = 4
# Phones write the place a file was recorded in under the first key; other MP4 writers
# use the second.
LOCATION_TAGS = ("com.apple.quicktime.location.ISO6709", "location")
CREATION_DATE_TAGS = ("com.apple.quicktime.creationdate", "creation_time")
# Decimal degrees only, as phones write them: `+DD.DDDD+DDD.DDDD`, an optional
# altitude, then the closing slash. The degrees-and-minutes forms are not read.
_ISO6709 = re.compile(r"([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?/?")
# The zero dates of the QuickTime and Unix clocks, which a recorder with no clock writes.
_EPOCH_DATES = frozenset({date(1904, 1, 1), date(1970, 1, 1)})
_MAX_LAT = 90.0
_MAX_LON = 180.0


class MediaError(Exception):
    """ffprobe or ffmpeg could not handle the file."""


@dataclass(frozen=True)
class Probe:
    """What ffprobe reports about the first audio stream and the file it is in."""

    codec: str
    format_names: frozenset[str]
    bit_rate: int | None
    duration_ms: int
    channels: int
    location: tuple[float, float] | None = None
    created_at: datetime | None = None
    sample_rate: int = 0
    # Seconds, when the first decoded sample plays; a browser recording may not start its
    # timestamps at 0.
    start_time: float = 0.0
    # Seconds, the start time the running ffmpeg counts its timestamps from. Some releases
    # put it an Opus pre-skip before `start_time`.
    container_start_time: float = 0.0


def parse_iso6709(value: str) -> tuple[float, float] | None:
    """Read the latitude and longitude from an ISO 6709 point, as a phone tags its recordings.

    Args:
        value: A point such as `+36.6612-080.9239+000.000/`.

    Returns:
        tuple[float, float] | None: Latitude and longitude in degrees at full precision, or
            None when the value is not a decimal-degrees point on the globe.
    """
    match = _ISO6709.fullmatch(value.strip())
    if match is None:
        return None
    lat, lon = float(match[1]), float(match[2])
    if abs(lat) > _MAX_LAT or abs(lon) > _MAX_LON:
        return None
    return lat, lon


def parse_creation_date(tags: Mapping[str, str], *, now: datetime) -> datetime | None:
    """Read when a file was recorded from its container tags.

    Args:
        tags: The container's tags, keys in any case.
        now: The current time; a date after it is a wrong clock, not a recording.

    Returns:
        datetime | None: The time in UTC, from the first tag of CREATION_DATE_TAGS present,
            or None when it is missing, unreadable, in the future, or a clock's zero date.
    """
    value = _tag(tags, CREATION_DATE_TAGS)
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    # A tag with no offset is UTC, as the MP4 creation time always is.
    created = parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    if created > now or created.date() in _EPOCH_DATES:
        return None
    return created


def _tag(tags: Mapping[str, str], keys: tuple[str, ...]) -> str | None:
    """The value of the first of `keys` present in `tags`, matching keys in any case."""
    folded = {str(key).casefold(): value for key, value in tags.items()}
    for key in keys:
        value = folded.get(key.casefold())
        if isinstance(value, str):
            return value
    return None


def passthrough_max_bitrate(channels: int) -> int:
    """Return the highest AAC bit rate that is served as uploaded.

    Re-encoding a file at or below this rate would only lose quality.

    Args:
        channels: The channel count of the file.

    Returns:
        int: Bits per second: 192 kbps for mono, 320 kbps for stereo and above.
    """
    return 192_000 if channels <= 1 else 320_000


def playback_bitrate(channels: int, source_bit_rate: int | None) -> int:
    """Return the AAC bit rate of a re-encoded playback file.

    Follows the source's rate so a re-encode does not shed quality the source had,
    held between a floor and the passthrough ceiling.

    Args:
        channels: The channel count of the source.
        source_bit_rate: The source's bits per second, or None when unknown.

    Returns:
        int: Bits per second. The floor is 96 kbps, doubled for stereo and above, and the
            ceiling is `passthrough_max_bitrate`.
    """
    floor = 96_000 if channels <= 1 else 192_000
    if source_bit_rate is None:
        return floor
    return max(floor, min(source_bit_rate, passthrough_max_bitrate(channels)))


@contextlib.asynccontextmanager
async def _media_process(argv: tuple[str, ...]) -> AsyncGenerator[asyncio.subprocess.Process]:
    """Start a tool with piped output, and kill and reap it on any exit it has not finished by.

    Covers a timeout, an error in the caller, and a cancelled job alike, so no ffmpeg
    outlives the work that started it.
    """
    # Only PATH is passed on: the API's environment holds every credential it has.
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={"PATH": os.environ.get("PATH", ""), "MALLOC_ARENA_MAX": "2"},
    )
    try:
        yield process
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


def _limited(*argv: str) -> tuple[str, ...]:
    """Prefix `argv` with a `prlimit` call that caps memory, CPU, and file size.

    Only on Linux, which production and CI run: macOS cannot limit address space.
    """
    if sys.platform != "linux":
        return argv
    return (
        "prlimit",
        f"--as={MEMORY_LIMIT_BYTES}",
        f"--cpu={int(SUBPROCESS_TIMEOUT_SECONDS)}",
        f"--fsize={FILE_LIMIT_BYTES}",
        "--",
        *argv,
    )


def ffmpeg(*args: str) -> tuple[str, ...]:
    """Build an ffmpeg command line, limited like every tool that opens an upload.

    Args:
        args: The options and files after the binary name.

    Returns:
        tuple[str, ...]: The full command line for `run_media_tool` or `stream_media_tool`.
    """
    return _limited("ffmpeg", "-filter_threads", "1", *args)


def ffprobe(*args: str) -> tuple[str, ...]:
    """Build an ffprobe command line, limited like every tool that opens an upload.

    Args:
        args: The options and files after the binary name.

    Returns:
        tuple[str, ...]: The full command line for `run_media_tool`.
    """
    return _limited("ffprobe", *args)


def hide_from_media_tools() -> None:
    """Stop a child running as the same user from reading this process through /proc.

    Without this, code run through a decoder bug could read the API's credentials from
    the parent's /proc entries, whatever environment the child itself was given. Only
    Linux has the flag, and execve resets it, so the tools themselves are unaffected.

    Raises:
        OSError: The kernel refused the change.
    """
    if sys.platform != "linux":
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def _tool(argv: tuple[str, ...]) -> str:
    """Name the tool `argv` runs, looking past a `_limited` prefix."""
    return argv[argv.index("--") + 1] if argv[0] == "prlimit" else argv[0]


def _check_exit(argv: tuple[str, ...], returncode: int | None, stderr: bytes) -> None:
    if returncode != 0:
        msg = f"{_tool(argv)} failed: {stderr.decode(errors='replace')[-500:]}"
        raise MediaError(msg)


async def run_media_tool(*argv: str) -> bytes:
    """Run an ffmpeg-family binary and return its stdout.

    Args:
        argv: The full command line, including the binary name.

    Returns:
        bytes: The process's stdout.
    """
    async with _media_process(argv) as process:
        try:
            async with asyncio.timeout(SUBPROCESS_TIMEOUT_SECONDS):
                stdout, stderr = await process.communicate()
        except TimeoutError:
            msg = f"{_tool(argv)} timed out"
            raise MediaError(msg) from None
    _check_exit(argv, process.returncode, stderr)
    return stdout


async def stream_media_tool(*argv: str, on_stdout: Callable[[bytes], None]) -> None:
    """Run an ffmpeg-family binary, handing its stdout to `on_stdout` chunk by chunk.

    For output too large to hold whole, such as an hour of decoded PCM: only one
    chunk is in memory at a time.

    Args:
        argv: The full command line, including the binary name.
        on_stdout: Called with each chunk of stdout, in order, as it arrives.
    """
    async with _media_process(argv) as process:
        stdout, stderr_pipe = process.stdout, process.stderr
        if stdout is None or stderr_pipe is None:
            msg = f"{_tool(argv)} started without its output pipes"
            raise MediaError(msg)
        # Drained alongside stdout, or a tool that fills the stderr pipe blocks forever.
        stderr_read = asyncio.create_task(stderr_pipe.read())
        try:
            async with asyncio.timeout(SUBPROCESS_TIMEOUT_SECONDS):
                while chunk := await stdout.read(STREAM_CHUNK_BYTES):
                    on_stdout(chunk)
                stderr = await stderr_read
                await process.wait()
        except TimeoutError:
            msg = f"{_tool(argv)} timed out"
            raise MediaError(msg) from None
        finally:
            stderr_read.cancel()
    _check_exit(argv, process.returncode, stderr)


async def probe(path: Path) -> Probe:
    """Read codec, container, bit rate, and duration, and where and when the file was recorded.

    Args:
        path: A local file.

    Returns:
        Probe: The facts the transcoder decides on.

    Raises:
        MediaError: ffprobe failed, or the file has no audio stream or no duration.
    """
    # Parsed without keeping the raw report in a local, where an error report would show
    # its location tag.
    try:
        report = json.loads(
            await run_media_tool(
                *ffprobe(
                    "-v",
                    "error",
                    "-print_format",
                    "json",
                    "-show_format",
                    "-show_streams",
                    *INPUT_GUARD,
                    str(path),
                )
            )
        )
    except json.JSONDecodeError as exc:
        msg = "ffprobe produced no report"
        raise MediaError(msg) from exc
    audio = next((s for s in report.get("streams", []) if s.get("codec_type") == "audio"), None)
    if audio is None:
        msg = "No audio stream"
        raise MediaError(msg)
    fmt = report.get("format", {})
    bit_rate = audio.get("bit_rate") or fmt.get("bit_rate")
    duration = audio.get("duration") or fmt.get("duration")
    if duration is None:
        msg = "No duration"
        raise MediaError(msg)
    tags = fmt.get("tags")
    tags = tags if isinstance(tags, dict) else {}
    location = _tag(tags, LOCATION_TAGS)
    container_start = _seconds(fmt.get("start_time"))
    start_time = await _first_sample_time(path)
    return Probe(
        codec=str(audio.get("codec_name", "")),
        format_names=frozenset(str(fmt.get("format_name", "")).split(",")),
        bit_rate=int(float(bit_rate)) if bit_rate else None,
        duration_ms=round(float(duration) * 1000),
        channels=int(audio.get("channels") or 1),
        location=parse_iso6709(location) if location is not None else None,
        created_at=parse_creation_date(tags, now=datetime.now(UTC)),
        sample_rate=int(audio.get("sample_rate") or 0),
        start_time=container_start if start_time is None else start_time,
        container_start_time=container_start,
    )


def _seconds(value: object) -> float:
    """A time ffprobe reports as text, or 0 when it reports none."""
    try:
        return float(str(value))
    except ValueError:
        return 0.0


# Enough packets to get past an AAC priming packet, which decodes to no samples.
_FIRST_SAMPLE_PACKETS = 8


async def _first_sample_time(path: Path) -> float | None:
    """Read when the first decoded sample of the first audio stream plays, in seconds.

    ffmpeg releases disagree on a container's start time: some report an Opus WebM's
    first packet, before the decoder's pre-skip, others its first decoded sample. The
    decoded frames agree across releases, so the timeline every seek counts from is
    taken from them. None when no frame decodes from the first packets.
    """
    report = await run_media_tool(
        *ffprobe(
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-read_intervals",
            f"%+#{_FIRST_SAMPLE_PACKETS}",
            "-show_entries",
            "frame=pts_time",
            "-of",
            "csv=p=0",
            *INPUT_GUARD,
            str(path),
        )
    )
    for line in report.decode(errors="replace").splitlines():
        try:
            return float(line.split(",")[0])
        except ValueError:
            continue
    return None


def _seek_args(info: Probe, from_ms: int, to_ms: int | None = None) -> tuple[str, ...]:
    """Build the input options that read a file from `from_ms` to `to_ms`.

    Seeks by absolute timestamp, counted from the probe's start time rather than the
    one the running ffmpeg reports, which can sit an Opus pre-skip earlier.

    Args:
        info: The probe of the file read.
        from_ms: Where the read starts, in milliseconds from the first decoded sample.
        to_ms: Where the read ends, or None for the end of the file.

    Returns:
        tuple[str, ...]: Options to place before `-i`.
    """
    stop = () if to_ms is None else ("-to", f"{info.start_time + to_ms / 1000:.6f}")
    return ("-seek_timestamp", "1", "-ss", f"{info.start_time + from_ms / 1000:.6f}", *stop)


def _timeline_args(info: Probe) -> tuple[str, ...]:
    """Build the input options that start a whole-file read's timestamps at its first sample.

    An input seek would do it too, but changes how an AAC source's priming is skipped.

    Args:
        info: The probe of the file read.

    Returns:
        tuple[str, ...]: Options to place before `-i`, empty when the running ffmpeg
            already counts from the first sample.
    """
    shift = info.container_start_time - info.start_time
    return () if abs(shift) < _TIMESTAMP_TOLERANCE_SECONDS else ("-itsoffset", f"{shift:.6f}")


def needs_encode(info: Probe) -> bool:
    """Decide whether a file is outside the playback profile and must be re-encoded.

    Args:
        info: The result of `probe`.

    Returns:
        bool: True when the file has more than two channels, or is not already
            AAC in MP4 at or below the passthrough rate for its channel count.
    """
    return info.channels > MAX_PLAYBACK_CHANNELS or not (
        info.codec == "aac"
        and "mp4" in info.format_names
        and info.bit_rate is not None
        and info.bit_rate <= passthrough_max_bitrate(info.channels)
    )


# A browser stamps each WebM packet with the clock at capture, so a stall leaves a hole in
# the timestamps that holds no samples. A forward step past one Opus frame is a real
# stall; the 1 ms rounding of the stamps and a few ms of clock drift per packet are
# not. Smaller steps, overlaps, and drift are left alone, so every sample is kept.
MIN_TIMESTAMP_GAP_SECONDS = 0.020
# Packet stamps are whole milliseconds, but less the start time they can miss by a float
# rounding error, and a packet stamped at the range's end falls outside `-to`.
_TIMESTAMP_TOLERANCE_SECONDS = 1e-6
_GAP_FORMATS = frozenset({"matroska", "webm"})


@dataclass(frozen=True)
class _Stall:
    """One forward step in a file's packet timestamps longer than a real stall."""

    # The latest stamp of any packet before the one after the stall.
    earlier_max_pts: float
    # Where the packet before the stall ends, or None when the stall opens the file.
    previous_end: float | None
    # The stamp of the packet after the stall.
    pts: float


@dataclass(frozen=True)
class StallMap:
    """Every stall in a file's packet timestamps, in file order, in seconds from its start time.

    Read once per file, so each range cut from it only intersects the map.
    """

    stalls: tuple[_Stall, ...] = ()


@dataclass(frozen=True)
class _Stalls:
    """The stalls in a range of a WebM's packet timestamps."""

    # Where each stall ends, in seconds from the file's start time, and its length.
    gaps: list[tuple[float, float]]
    # Whether the range starts inside a stall, so the audio begins late.
    starts_in_stall: bool = False
    # Seconds of the stall the range ends inside, which the audio does not reach.
    end_silence: float = 0.0


def _has_stalls(info: Probe) -> bool:
    """Whether the file's container stamps packets with a capture clock that can stall."""
    return bool(info.format_names & _GAP_FORMATS) and bool(info.sample_rate)


async def scan_stalls(source: Path, info: Probe) -> StallMap:
    """Find every stall in a WebM's packet timestamps, reading the whole file once.

    Args:
        source: The file to read.
        info: The probe of `source`.

    Returns:
        StallMap: The file's stalls, empty for a container that never stalls.
    """
    if not _has_stalls(info):
        return StallMap()
    report = await run_media_tool(
        *ffprobe(
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "packet=pts_time,duration_time",
            "-of",
            "csv=p=0",
            *INPUT_GUARD,
            str(source),
        )
    )
    stalls: list[_Stall] = []
    earlier_max_pts = float("-inf")
    previous_end: float | None = None
    for line in report.decode(errors="replace").splitlines():
        fields = line.split(",")
        try:
            pts, duration = float(fields[0]) - info.start_time, float(fields[1])
        except (ValueError, IndexError):
            continue
        if pts - (previous_end or 0) > MIN_TIMESTAMP_GAP_SECONDS:
            stalls.append(_Stall(earlier_max_pts, previous_end, pts))
        earlier_max_pts = max(earlier_max_pts, pts)
        previous_end = pts + duration
    return StallMap(tuple(stalls))


def _range_stalls(stall_map: StallMap, from_ms: int, to_ms: int | None) -> _Stalls:
    """Intersect a file's stalls with a range.

    A stall the range starts or ends inside counts only for the part inside it.

    Args:
        stall_map: The file's stalls.
        from_ms: Start of the range, in milliseconds from the file's start time.
        to_ms: End of the range, or None for the rest of the file.

    Returns:
        _Stalls: The stalls, with timestamps relative to the file's start time, which is
            what ffmpeg's `-ss` and `-to` and the filter graph count from.
    """
    low = max(0, from_ms) / 1000
    high = None if to_ms is None else to_ms / 1000
    gaps: list[tuple[float, float]] = []
    starts_in_stall = False
    for stall in stall_map.stalls:
        if high is not None:
            edge = high - _TIMESTAMP_TOLERANCE_SECONDS
            # A packet with no stall before it reached the end first.
            if stall.earlier_max_pts >= edge:
                break
            if stall.pts >= edge:
                end_silence = _end_silence(stall.pts, stall.previous_end, low, high)
                return _Stalls(gaps, starts_in_stall, end_silence)
        if stall.pts > low and stall.previous_end is not None:
            stalled = stall.pts - max(stall.previous_end, low)
            if stalled > MIN_TIMESTAMP_GAP_SECONDS:
                gaps.append((stall.pts, stalled))
                starts_in_stall = starts_in_stall or stall.previous_end <= low
    return _Stalls(gaps, starts_in_stall)


def _end_silence(next_pts: float, previous_end: float | None, low: float, high: float) -> float:
    """Measure the part of a range that falls in the stall before the packet after it."""
    stall_start = max(previous_end or 0, low)
    stalled = next_pts - (previous_end or 0)
    return high - stall_start if stalled > MIN_TIMESTAMP_GAP_SECONDS and stall_start < high else 0.0


async def _fill_gap_args(
    source: Path,
    info: Probe,
    *,
    from_ms: int = 0,
    to_ms: int | None = None,
    pad_end: bool = False,
    stalls: StallMap | None = None,
) -> tuple[str, ...]:
    """Build the ffmpeg filter that puts silence where a WebM's timestamps stall.

    Frames are re-stamped from their sample count plus the stalls so far, so the filter
    sees only the stalls. Drift and backward steps in the stamps never reach it, and it
    never drops or stretches audio. A source with no stall gets no filter at all.

    Args:
        source: The file to read.
        info: The probe of `source`.
        from_ms: Where the read starts, which ffmpeg counts timestamps from.
        to_ms: Where the read ends, or None for the end of the file.
        pad_end: Whether to pad the output with silence to the end of the range when the
            range ends in a stall.
        stalls: The stalls of `source`, when a scan has already read them.

    Returns:
        tuple[str, ...]: ffmpeg options, empty when nothing needs filling.
    """
    if not _has_stalls(info):
        return ()
    stall_map = stalls if stalls is not None else await scan_stalls(source, info)
    found = _range_stalls(stall_map, from_ms, to_ms)
    end_silence = found.end_silence if pad_end else 0.0
    if not found.gaps and not end_silence:
        return ()
    shift = from_ms / 1000
    stalled = "+".join(f"if(gte(PTS*TB,{at - shift:.6f}),{gap:.6f},0)" for at, gap in found.gaps)
    # The first frame's stamp already holds the part of a stall the range starts inside.
    origin = "" if found.starts_in_stall else "STARTPTS+"
    filters = [f"asetpts='{origin}N/SR/TB+({stalled or 0})/TB'"]
    first = "first_pts=0:" if found.starts_in_stall else ""
    filters.append(f"aresample=async=1:{first}min_hard_comp={MIN_TIMESTAMP_GAP_SECONDS / 2}")
    if end_silence:
        filters.append(f"apad=pad_dur={end_silence:.6f}")
    return ("-af", ",".join(filters))


# Shared by encode and cut, so a change to the playback profile applies to every path
# that produces a playback file.
def _playback_codec_args(info: Probe) -> tuple[str, ...]:
    """Build the ffmpeg codec options: mono stays mono, anything wider mixes down to stereo.

    Args:
        info: The probe of the source.

    Returns:
        tuple[str, ...]: The channel, codec, bit rate, and bandwidth options.
    """
    channels = 1 if info.channels <= 1 else 2
    bit_rate = playback_bitrate(info.channels, info.bit_rate)
    bandwidth = (
        ("-cutoff", str(LOWPASS_HZ)) if bit_rate >= WIDE_BAND_BITRATE_PER_CHANNEL * channels else ()
    )
    return ("-ac", str(channels), "-c:a", "aac", "-b:a", str(bit_rate), *bandwidth)


async def _to_mp4(
    source: Path,
    target: Path,
    *codec_args: str,
    pre_input_args: tuple[str, ...] = (),
    max_ms: int | None = None,
) -> None:
    """Write the audio of `source` to an MP4 with the index at the front, so playback starts at once.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        codec_args: ffmpeg output codec options, placed after `-vn`.
        pre_input_args: ffmpeg options that must precede `-i` to take effect, such as
            a demuxer-level seek.
        max_ms: The longest output written, or None to write the whole input.
    """
    limit = ("-t", f"{max_ms}ms") if max_ms is not None else ()
    await run_media_tool(
        *ffmpeg(
            "-v",
            "error",
            "-y",
            *INPUT_GUARD,
            *pre_input_args,
            "-i",
            str(source),
            "-vn",
            *codec_args,
            *limit,
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            str(target),
        )
    )


async def remux(source: Path, target: Path, *, max_ms: int | None = None) -> None:
    """Rewrite the container only.

    Fails with ffmpeg's `MediaError`, most often because the codec cannot live in MP4.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        max_ms: The longest output written, or None to write the whole input.
    """
    await _to_mp4(source, target, "-c:a", "copy", max_ms=max_ms)


async def _info(source: Path, info: Probe | None) -> Probe:
    return info if info is not None else await probe(source)


async def encode(
    source: Path,
    target: Path,
    *,
    info: Probe | None = None,
    max_ms: int | None = None,
    stalls: StallMap | None = None,
) -> None:
    """Encode to AAC-LC in MP4 at the playback bit rate for the source.

    Fails with ffprobe's or ffmpeg's `MediaError`, most often because the file cannot be
    decoded.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        info: The probe of `source`, when one has already read it.
        max_ms: The longest output written, or None to write the whole input.
        stalls: The stalls of `source`, when a scan has already read them.
    """
    info = await _info(source, info)
    fill = await _fill_gap_args(source, info, to_ms=max_ms, stalls=stalls)
    await _to_mp4(
        source,
        target,
        *fill,
        *_playback_codec_args(info),
        pre_input_args=_timeline_args(info),
        max_ms=max_ms,
    )


async def cut(
    source: Path,
    target: Path,
    start_ms: int,
    end_ms: int,
    *,
    info: Probe | None = None,
    stalls: StallMap | None = None,
) -> None:
    """Re-encode the `start_ms` to `end_ms` range of `source` to a playback MP4.

    Always re-encodes from the original, even when it is already AAC: `-ss`/`-to`
    placed before `-i` seek the demuxer to the nearest keyframe, which a
    stream copy could not trim to an exact sample. Fails with ffprobe's or ffmpeg's
    `MediaError`, most often because the file cannot be decoded.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        start_ms: Where the kept range starts, in milliseconds.
        end_ms: Where the kept range ends, in milliseconds.
        info: The probe of `source`, when one has already read it.
        stalls: The stalls of `source`, when a scan has already read them.
    """
    info = await _info(source, info)
    fill = await _fill_gap_args(
        source, info, from_ms=start_ms, to_ms=end_ms, pad_end=True, stalls=stalls
    )
    await _to_mp4(
        source,
        target,
        *fill,
        *_playback_codec_args(info),
        pre_input_args=_seek_args(info, start_ms, end_ms),
    )


@dataclass(frozen=True)
class _CopyTarget:
    """A container whose audio stream copies cleanly into a file of the same family."""

    accepts: Callable[[Probe], bool]
    output_args: tuple[str, ...]
    content_type: str
    # How far before the cut the copy starts, and past its end it runs.
    lead_ms: int = 0


# An MP3 slice decodes from a point after its first packet, since the decoder spends its
# first samples on delay. Starting the copy this far before the cut keeps that point at
# or before the cut, and the slice that much longer keeps it covering the end.
MP3_LEAD_MS = 50
_MP3 = _CopyTarget(
    accepts=lambda info: info.codec == "mp3" and "mp3" in info.format_names,
    output_args=("-f", "mp3"),
    content_type="audio/mpeg",
    lead_ms=MP3_LEAD_MS,
)
_COPY_TARGETS = (
    _CopyTarget(
        accepts=lambda info: info.codec == "aac" and "mp4" in info.format_names,
        output_args=("-movflags", "+faststart", "-f", "mp4"),
        content_type=PLAYBACK_MIME,
    ),
    _MP3,
    _CopyTarget(
        accepts=lambda info: info.codec.startswith("pcm_") and "wav" in info.format_names,
        output_args=("-f", "wav"),
        content_type="audio/wav",
    ),
)
# Samples compared to locate a decoded slice inside its decoded original, taken past the
# first frames, which a decoder starting mid-stream has no earlier frame to build on. A
# run of samples that matches more than one place, such as silence or a steady tone, says
# nothing, so later runs are tried in steps across the searched span.
_MATCH_SKIP_MS = 100
_MATCH_SAMPLES = 64
_MATCH_STEP_MS = 50
_MATCH_SPAN_SECONDS = 10.0
_MATCH_LEAD_SECONDS = 1.0


def _copy_target(info: Probe) -> _CopyTarget | None:
    """The container a stream copy of this source is written in, or None if it has none."""
    return next((target for target in _COPY_TARGETS if target.accepts(info)), None)


def slice_content_type(info: Probe) -> str:
    """Name the type of the file `copy_slice` writes from a source with this probe.

    Args:
        info: The probe of the source being sliced.

    Returns:
        str: The source's container type, or M4A when the slice is re-encoded.
    """
    target = _copy_target(info)
    return PLAYBACK_MIME if target is None else target.content_type


async def _decode_pcm(path: Path, rate: int, *args: str) -> bytes:
    return await run_media_tool(
        *ffmpeg(
            "-v",
            "error",
            *INPUT_GUARD,
            *args,
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(rate),
            "-f",
            "s16le",
            "-",
        )
    )


def _unique_match(original: bytes, needle: bytes) -> int | None:
    """The one sample position `needle` decodes at in `original`, or None if not exactly one."""
    found: int | None = None
    at = original.find(needle)
    while at != -1:
        if at % 2 == 0:
            if found is not None:
                return None
            found = at // 2
        at = original.find(needle, at + 1)
    return found


async def _mp3_decoded_start_ms(
    source: Path, slice_path: Path, seek_ms: int, info: Probe, slice_info: Probe
) -> int:
    """Find where the first decoded sample of an MP3 slice sits in the decoded original.

    A slice has no gapless header, so its decoder skips fewer samples than the
    original's does and the first decoded sample is not at the packet's pts. The
    offset is measured by matching decoded samples at their own rate. When no run of
    samples in the searched span matches exactly one place, as in a slice that is all
    silence or a steady tone, the copy's start is returned: any offset decodes alike there.

    Raises:
        MediaError: The slice reports no sample rate.
    """
    rate = slice_info.sample_rate
    if not rate:
        msg = f"{slice_path.name} reports no sample rate to align it by"
        raise MediaError(msg)
    window_from = max(0.0, seek_ms / 1000 - _MATCH_LEAD_SECONDS)
    original = await _decode_pcm(
        source,
        rate,
        *_seek_args(info, round(window_from * 1000)),
        "-t",
        f"{_MATCH_SPAN_SECONDS + 2 * _MATCH_LEAD_SECONDS}",
    )
    sliced = await _decode_pcm(slice_path, rate, "-t", f"{_MATCH_SPAN_SECONDS}")
    step = rate * _MATCH_STEP_MS // 1000
    for at in range(rate * _MATCH_SKIP_MS // 1000, len(sliced) // 2 - _MATCH_SAMPLES, step):
        needle = sliced[2 * at : 2 * (at + _MATCH_SAMPLES)]
        if needle.count(needle[:2]) == _MATCH_SAMPLES:
            continue
        found = _unique_match(original, needle)
        if found is not None:
            return round((window_from + (found - at) / rate) * 1000)
    return seek_ms


class Slice(NamedTuple):
    """A slice `copy_slice` wrote."""

    # Where the first decoded sample of the slice sits on the source's timeline, in ms.
    start_ms: int
    # The probe of the slice.
    info: Probe


async def copy_slice(
    source: Path,
    target: Path,
    start_ms: int,
    end_ms: int,
    *,
    info: Probe | None = None,
    stalls: StallMap | None = None,
) -> Slice:
    """Copy a range of an original without re-encoding, so the audio stays bit-exact.

    The slice starts at the last packet at or before `start_ms` and ends at the first
    packet at or after `end_ms`. Decoding `target` from its start gives the same
    samples as decoding `source` from the returned offset. A source with no stream-copy
    container, such as WebM, is re-encoded to M4A over exactly the range.

    Args:
        source: The file to read.
        target: The file to write, in the source's container family when copied.
        start_ms: Where the range starts, in milliseconds on the source's timeline.
        end_ms: Where the range ends, in milliseconds on the source's timeline.
        info: The probe of `source`, when one has already read it.
        stalls: The stalls of `source`, when a scan has already read them.

    Returns:
        Slice: The slice's probe, and where its first decoded sample sits on the
            source's timeline, which is `start_ms` when the range was re-encoded.
    """
    info = await _info(source, info)
    copy = _copy_target(info)
    if copy is None:
        await cut(source, target, start_ms, end_ms, info=info, stalls=stalls)
        return Slice(start_ms, await probe(target))
    copy_from, copy_to = max(0, start_ms - copy.lead_ms), end_ms + copy.lead_ms
    await run_media_tool(
        *ffmpeg(
            "-v",
            "error",
            "-y",
            *INPUT_GUARD,
            *_seek_args(info, copy_from),
            "-i",
            str(source),
            "-vn",
            "-map_metadata",
            "-1",
            "-c:a",
            "copy",
            "-t",
            f"{copy_to - copy_from}ms",
            *copy.output_args,
            str(target),
        )
    )
    slice_info = await probe(target)
    if copy is _MP3:
        start = await _mp3_decoded_start_ms(source, target, copy_from, info, slice_info)
        return Slice(start, slice_info)
    # MP4 and WAV slices begin exactly at the cut: the MP4 edit list hides the leading
    # packet samples before it, and WAV packets split at any sample.
    return Slice(start_ms, slice_info)
