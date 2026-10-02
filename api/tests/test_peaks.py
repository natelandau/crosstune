"""The waveform peaks format: build from audio, and the pure helpers clients and jobs share."""

from __future__ import annotations

import array
import time

import pytest

from crosstune.jobs import peaks as peaks_module
from crosstune.jobs.peaks import (
    PEAKS_PER_SECOND,
    PEAKS_VERSION,
    build_peaks,
    decode_peaks,
    encode_peaks,
    reduce_pcm,
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
    values = decode_peaks(await build_peaks(long_m4a))
    assert 179_999 <= len(values) <= 180_001 + AAC_PADDING_WINDOWS


@pytest.mark.parametrize("chunk_bytes", [1, 7, 320, 333, 65_536])
async def test_build_peaks_matches_a_whole_buffer_reduction_for_any_chunking(
    monkeypatch: pytest.MonkeyPatch, tmp_path, chunk_bytes: int
) -> None:
    # Odd length, so the stray trailing byte and the partial last window both occur.
    raw = array.array("h", [(i * 37) % 65_536 - 32_768 for i in range(1_000)]).tobytes() + b"\x01"

    async def fake_stream(*_argv: str, on_stdout) -> None:
        for start in range(0, len(raw), chunk_bytes):
            on_stdout(raw[start : start + chunk_bytes])

    monkeypatch.setattr(peaks_module, "stream_media_tool", fake_stream)
    assert decode_peaks(await build_peaks(tmp_path / "any")) == reduce_pcm(raw)


def test_reduce_pcm_keeps_up_with_an_hour() -> None:
    # Only the reduction is timed: decoding speed belongs to ffmpeg and the machine. CPU
    # time, not wall time, so the suite's other workers competing for cores never count.
    hour = array.array("h", [0, 20_000, 0, -20_000] * 2_000).tobytes() * 3_600
    start = time.process_time()
    values = reduce_pcm(hour)
    elapsed = time.process_time() - start
    assert len(values) == 3_600 * PEAKS_PER_SECOND
    assert elapsed < 10


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
