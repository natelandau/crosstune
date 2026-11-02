"""Whether a recording is mono: its channels carry the same audio, so it has no stereo field."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from crosstune.jobs.media import decode_to_pcm, pcm_samples, probe, stream_media_tool

if TYPE_CHECKING:
    from pathlib import Path

# The Apple client measures with the same rule, so both agree on any one file.
MEASURE_SECONDS = 120
# Mean energy per sample, on samples scaled to -1..1.
SILENT_ENERGY = 1e-10
QUIET_UNDER_LOUD_DB = 40.0
MIN_CORRELATION = 0.999
_SAMPLE_RATE = 11_025
_FRAME_BYTES = 4  # one signed 16-bit sample for each of two channels
_FULL_SCALE = 32_768


async def measure_mono(source: Path) -> bool:
    """Decide whether `source` is mono, so a client can hide a stereo range that does nothing.

    Reads up to the first `MEASURE_SECONDS`. A file is mono when it has one channel, when
    both channels' mean energy per sample is under `SILENT_ENERGY`, when its quieter
    channel is more than `QUIET_UNDER_LOUD_DB` under its louder one, or when the
    normalized correlation of its channels is at least `MIN_CORRELATION`. Fails with
    ffmpeg's `MediaError` when the file cannot be decoded.

    Args:
        source: A local audio file.

    Returns:
        bool: Whether the file is mono.
    """
    if (await probe(source)).channels <= 1:
        return True
    reducer = _EnergyReducer()
    await stream_media_tool(
        *decode_to_pcm(source, channels=2, rate=_SAMPLE_RATE, max_seconds=MEASURE_SECONDS),
        on_stdout=reducer.feed,
    )
    return reducer.is_mono()


class _EnergyReducer:
    """Sum each channel's energy and their cross term as PCM streams in."""

    def __init__(self) -> None:
        self._left = 0
        self._right = 0
        self._cross = 0
        self._frames = 0
        self._pending = b""

    def feed(self, chunk: bytes) -> None:
        """Add every whole frame `chunk` completes and keep the rest for the next one."""
        data = self._pending + chunk
        whole = len(data) - len(data) % _FRAME_BYTES
        self._pending = data[whole:]
        samples = pcm_samples(data[:whole])
        left, right = samples[0::2], samples[1::2]
        # sumprod runs in C and stays exact on ints.
        self._left += math.sumprod(left, left)
        self._right += math.sumprod(right, right)
        self._cross += math.sumprod(left, right)
        self._frames += len(left)

    def is_mono(self) -> bool:
        """Apply the mono rule to the energy summed so far."""
        louder = max(self._left, self._right)
        if self._frames == 0 or louder / self._frames / _FULL_SCALE**2 < SILENT_ENERGY:
            return True
        quieter = min(self._left, self._right)
        if quieter < louder * 10 ** (-QUIET_UNDER_LOUD_DB / 10):
            return True
        # Both channels hold energy past the checks above, so the root is never zero.
        return self._cross / math.sqrt(self._left * self._right) >= MIN_CORRELATION
