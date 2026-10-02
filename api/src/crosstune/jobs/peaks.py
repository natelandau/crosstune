"""The waveform peaks file: one byte per 20 ms window, the amplitude both clients draw."""

from __future__ import annotations

import array
import sys
from typing import TYPE_CHECKING

from crosstune.jobs.media import INPUT_GUARD, stream_media_tool

if TYPE_CHECKING:
    from pathlib import Path

PEAKS_VERSION = 1
PEAKS_PER_SECOND = 50
_HEADER_SIZE = 3
_SAMPLE_RATE = 8_000
_WINDOW_SAMPLES = _SAMPLE_RATE // PEAKS_PER_SECOND
_WINDOW_BYTES = _WINDOW_SAMPLES * 2
_FULL_SCALE = 32_768  # magnitude of the most negative sample in signed 16-bit PCM


async def build_peaks(source: Path) -> bytes:
    """Decode `source` to mono 8 kHz PCM and reduce it to one peak byte per 20 ms window.

    Args:
        source: A local audio file.

    Returns:
        bytes: A full peaks file, header and all.

    Raises:
        MediaError: ffmpeg failed, most often because the file cannot be decoded.
    """
    reducer = _PeakReducer()
    await stream_media_tool(
        "ffmpeg",
        "-v",
        "error",
        *INPUT_GUARD,
        "-i",
        str(source),
        "-ac",
        "1",
        "-ar",
        str(_SAMPLE_RATE),
        "-f",
        "s16le",
        "-",
        on_stdout=reducer.feed,
    )
    return encode_peaks(reducer.finish())


class _PeakReducer:
    """Reduce PCM to peak bytes as it streams in, holding at most one partial window."""

    def __init__(self) -> None:
        self._peaks = bytearray()
        self._pending = b""

    def feed(self, chunk: bytes) -> None:
        """Reduce every whole window `chunk` completes and keep the rest for the next one."""
        data = self._pending + chunk
        whole = len(data) - len(data) % _WINDOW_BYTES
        self._peaks += reduce_pcm(data[:whole])
        self._pending = data[whole:]

    def finish(self) -> bytes:
        """Reduce the final partial window, as `reduce_pcm` would, and return every peak byte."""
        self._peaks += reduce_pcm(self._pending)
        self._pending = b""
        return bytes(self._peaks)


def reduce_pcm(raw: bytes) -> bytes:
    """Reduce mono 8 kHz signed 16-bit little-endian PCM to one peak byte per 20 ms window.

    Reading raw samples in pure Python, rather than ffmpeg's astats/ametadata
    filter, is an order of magnitude faster for an hour of audio and needs no
    extra dependency.

    Args:
        raw: The PCM ffmpeg decoded.

    Returns:
        bytes: The peak bytes, without the format header.
    """
    samples = array.array("h")
    # A stray trailing byte from an odd sample count would otherwise raise on frombytes.
    whole = len(raw) - len(raw) % samples.itemsize
    samples.frombytes(raw[:whole])
    if sys.byteorder == "big":
        # ffmpeg's s16le output is always little-endian; array.array reads it in
        # host order, so a big-endian host must swap before treating it as PCM.
        samples.byteswap()
    windows = range(0, len(samples), _WINDOW_SAMPLES)
    return bytes(_window_peak(samples[start : start + _WINDOW_SAMPLES]) for start in windows)


def _window_peak(window: array.array) -> int:
    """Scale one window's largest sample magnitude to a byte."""
    if not window:
        return 0
    # The builtins scan the slice in C, far faster than a per-sample generator.
    highest, lowest = max(window), min(window)
    peak = max(highest, -lowest)
    return round(min(peak / _FULL_SCALE, 1.0) * 255)


def encode_peaks(values: bytes) -> bytes:
    """Prefix raw per-window peak bytes with the format header.

    Args:
        values: One byte per 20 ms window, already scaled to 0-255.

    Returns:
        bytes: The version byte, big-endian points-per-second, then `values`.
    """
    return bytes([PEAKS_VERSION]) + PEAKS_PER_SECOND.to_bytes(2, "big") + values


def decode_peaks(data: bytes) -> bytes:
    """Check the header and return the raw per-window peak bytes.

    Args:
        data: A full peaks file.

    Returns:
        bytes: One byte per 20 ms window.

    Raises:
        ValueError: `data` is too short, or its header names a different version
            or points-per-second than this format.
    """
    if len(data) < _HEADER_SIZE:
        msg = f"Peaks header needs {_HEADER_SIZE} bytes, got {len(data)}"
        raise ValueError(msg)
    version = data[0]
    points_per_second = int.from_bytes(data[1:3], "big")
    if version != PEAKS_VERSION or points_per_second != PEAKS_PER_SECOND:
        msg = f"Unsupported peaks header: version={version}, points_per_second={points_per_second}"
        raise ValueError(msg)
    return data[_HEADER_SIZE:]


def slice_peaks(data: bytes, start_ms: int, end_ms: int) -> bytes:
    """Cut a full peaks file down to the `start_ms` to `end_ms` range of its own file.

    Args:
        data: A full peaks file, offsets relative to its own start.
        start_ms: Where the kept range starts, in milliseconds.
        end_ms: Where the kept range ends, in milliseconds.

    Returns:
        bytes: A standalone peaks file, header and all, covering only that range.

    Raises:
        ValueError: `data`'s header names a different version or points-per-second
            than this format.
    """
    values = decode_peaks(data)
    start = start_ms * PEAKS_PER_SECOND // 1000
    end = end_ms * PEAKS_PER_SECOND // 1000
    return encode_peaks(values[start:end])
