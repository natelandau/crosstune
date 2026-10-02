"""ffprobe and ffmpeg as subprocesses. Nothing here touches the database or the bucket."""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import json
import os
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from pathlib import Path

MAX_PLAYBACK_CHANNELS = 2
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


class MediaError(Exception):
    """ffprobe or ffmpeg could not handle the file."""


@dataclass(frozen=True)
class Probe:
    """What ffprobe reports about the first audio stream."""

    codec: str
    format_names: frozenset[str]
    bit_rate: int | None
    duration_ms: int
    channels: int


def passthrough_max_bitrate(channels: int) -> int:
    """Return the highest AAC bit rate that is served as uploaded.

    Re-encoding a file at or below this rate would only lose quality.

    Args:
        channels: The channel count of the file.

    Returns:
        int: Bits per second, doubled for stereo and above.
    """
    return 192_000 if channels <= 1 else 320_000


def playback_bitrate(channels: int) -> int:
    """Return the AAC bit rate of a re-encoded playback file.

    Args:
        channels: The channel count of the source.

    Returns:
        int: Bits per second, doubled for stereo and above.
    """
    return 96_000 if channels <= 1 else 192_000


@contextlib.asynccontextmanager
async def _media_process(argv: tuple[str, ...]) -> AsyncIterator[asyncio.subprocess.Process]:
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
    """Run `argv` under memory, CPU, and file-size limits.

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
    """Read codec, container, bit rate, and duration.

    Args:
        path: A local file.

    Returns:
        Probe: The facts the transcoder decides on.

    Raises:
        MediaError: ffprobe failed, or the file has no audio stream or no duration.
    """
    raw = await run_media_tool(
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
        channels=int(audio.get("channels") or 1),
    )


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


# Shared by encode and cut, so a change to the playback profile applies to every path
# that produces a playback file.
def _playback_codec_args(channels: int) -> tuple[str, ...]:
    """Build the ffmpeg codec options: mono stays mono, anything wider mixes down to stereo.

    Args:
        channels: The channel count of the source.

    Returns:
        tuple[str, ...]: The channel, codec, and bit rate options.
    """
    return (
        "-ac",
        "1" if channels <= 1 else "2",
        "-c:a",
        "aac",
        "-b:a",
        str(playback_bitrate(channels)),
    )


async def _to_mp4(
    source: Path, target: Path, *codec_args: str, pre_input_args: tuple[str, ...] = ()
) -> None:
    """Write the audio of `source` to an MP4 with the index at the front, so playback starts at once.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        codec_args: ffmpeg output codec options, placed after `-vn`.
        pre_input_args: ffmpeg options that must precede `-i` to take effect, such as
            a demuxer-level seek.
    """
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
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            str(target),
        )
    )


async def remux(source: Path, target: Path) -> None:
    """Rewrite the container only.

    Args:
        source: The file to read.
        target: The MP4 file to write.

    Raises:
        MediaError: ffmpeg failed, most often because the codec cannot live in MP4.
    """
    await _to_mp4(source, target, "-c:a", "copy")


async def _channels(source: Path, channels: int | None) -> int:
    return channels if channels is not None else (await probe(source)).channels


async def encode(source: Path, target: Path, *, channels: int | None = None) -> None:
    """Encode to AAC-LC in MP4 at the playback bit rate for the source's channel count.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        channels: The source's channel count, when a probe has already read it.

    Raises:
        MediaError: ffprobe or ffmpeg failed, most often because the file cannot be decoded.
    """
    await _to_mp4(source, target, *_playback_codec_args(await _channels(source, channels)))


async def cut(
    source: Path, target: Path, start_ms: int, end_ms: int, *, channels: int | None = None
) -> None:
    """Re-encode the `start_ms` to `end_ms` range of `source` to a playback MP4.

    Always re-encodes from the original, even when it is already AAC: `-ss`/`-to`
    placed before `-i` seek the demuxer to the nearest keyframe, which a
    stream copy could not trim to an exact sample.

    Args:
        source: The file to read.
        target: The MP4 file to write.
        start_ms: Where the kept range starts, in milliseconds.
        end_ms: Where the kept range ends, in milliseconds.
        channels: The source's channel count, when a probe has already read it.

    Raises:
        MediaError: ffprobe or ffmpeg failed, most often because the file cannot be decoded.
    """
    await _to_mp4(
        source,
        target,
        *_playback_codec_args(await _channels(source, channels)),
        pre_input_args=("-ss", f"{start_ms}ms", "-to", f"{end_ms}ms"),
    )
