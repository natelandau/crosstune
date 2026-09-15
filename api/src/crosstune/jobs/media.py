"""ffprobe and ffmpeg as subprocesses. Nothing here touches the database or the bucket."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

PLAYBACK_BITRATE = 96_000
# AAC in MP4 at or below this rate is served as uploaded; re-encoding it would only lose quality.
PASSTHROUGH_MAX_BITRATE = 192_000
SUBPROCESS_TIMEOUT_SECONDS = 300.0


class MediaError(Exception):
    """ffprobe or ffmpeg could not handle the file."""


@dataclass(frozen=True)
class Probe:
    """What ffprobe reports about the first audio stream."""

    codec: str
    format_names: frozenset[str]
    bit_rate: int | None
    duration_ms: int


async def _run(*argv: str) -> bytes:
    """Run an ffmpeg-family binary and return its stdout.

    Args:
        argv: The full command line, including the binary name.

    Returns:
        bytes: The process's stdout.
    """
    process = await asyncio.create_subprocess_exec(
        *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        async with asyncio.timeout(SUBPROCESS_TIMEOUT_SECONDS):
            stdout, stderr = await process.communicate()
    except TimeoutError:
        process.kill()
        await process.wait()
        msg = f"{argv[0]} timed out"
        raise MediaError(msg) from None
    if process.returncode != 0:
        msg = f"{argv[0]} failed: {stderr.decode(errors='replace')[-500:]}"
        raise MediaError(msg)
    return stdout


async def probe(path: Path) -> Probe:
    """Read codec, container, bit rate, and duration.

    Args:
        path: A local file.

    Returns:
        Probe: The facts the transcoder decides on.

    Raises:
        MediaError: ffprobe failed, or the file has no audio stream or no duration.
    """
    raw = await _run(
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    )
    try:
        report = json.loads(raw)
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
    return Probe(
        codec=str(audio.get("codec_name", "")),
        format_names=frozenset(str(fmt.get("format_name", "")).split(",")),
        bit_rate=int(float(bit_rate)) if bit_rate else None,
        duration_ms=round(float(duration) * 1000),
    )


def needs_encode(info: Probe) -> bool:
    """Decide whether a file is outside the playback profile and must be re-encoded.

    Args:
        info: The result of `probe`.

    Returns:
        bool: True unless the file is already AAC in MP4 at or below the passthrough rate.
    """
    return not (
        info.codec == "aac"
        and "mp4" in info.format_names
        and info.bit_rate is not None
        and info.bit_rate <= PASSTHROUGH_MAX_BITRATE
    )


async def remux(source: Path, target: Path) -> None:
    """Rewrite the container only, with the index at the front so playback starts immediately.

    Args:
        source: The file to read.
        target: The MP4 file to write.

    Raises:
        MediaError: ffmpeg failed, most often because the codec cannot live in MP4.
    """
    await _run(
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(target),
    )


async def encode(source: Path, target: Path) -> None:
    """Encode to AAC-LC in MP4 at the playback bit rate.

    Args:
        source: The file to read.
        target: The MP4 file to write.

    Raises:
        MediaError: ffmpeg failed, most often because the file cannot be decoded.
    """
    await _run(
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        str(PLAYBACK_BITRATE),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(target),
    )
