"""The waveform peaks format: build from audio, and the pure helpers clients and jobs share."""

from __future__ import annotations

import time

import pytest

from crosstune.jobs.peaks import (
    PEAKS_PER_SECOND,
    PEAKS_VERSION,
    build_peaks,
    decode_peaks,
    encode_peaks,
    slice_peaks,
)

pytestmark = pytest.mark.anyio

# Some ffmpeg releases, 7.1 among them, decode an AAC file's trailing encoder padding as
# audio, which adds up to this many near-silent windows past the tone. Others trim it.
AAC_PADDING_WINDOWS = 3


async def test_build_peaks_rate_and_scale(media_fixtures) -> None:
    values = decode_peaks(await build_peaks(media_fixtures["full_scale"]))
    assert 99 <= len(values) <= 101 + AAC_PADDING_WINDOWS
    assert all(v > 200 for v in values[:99])


async def test_build_peaks_is_near_silent_for_a_silent_file(media_fixtures) -> None:
    values = decode_peaks(await build_peaks(media_fixtures["silence"]))
    assert all(v < 3 for v in values)


async def test_build_peaks_hour_long(long_m4a) -> None:
    start = time.monotonic()
    values = decode_peaks(await build_peaks(long_m4a))
    elapsed = time.monotonic() - start
    assert 179_999 <= len(values) <= 180_001 + AAC_PADDING_WINDOWS
    assert elapsed < 20


def test_encode_and_decode_round_trip() -> None:
    values = bytes(range(10))
    encoded = encode_peaks(values)
    assert encoded[0] == PEAKS_VERSION
    assert int.from_bytes(encoded[1:3], "big") == PEAKS_PER_SECOND
    assert decode_peaks(encoded) == values


def test_decode_rejects_bad_header() -> None:
    with pytest.raises(ValueError, match="header"):
        decode_peaks(bytes([9, 0, 50, 1, 2, 3]))
    with pytest.raises(ValueError, match="header"):
        decode_peaks(b"")


def test_slice_peaks() -> None:
    values = bytes(range(100))
    data = encode_peaks(values)
    sliced = decode_peaks(slice_peaks(data, 400, 1000))
    assert sliced == values[20:50]
    assert len(sliced) == 30
