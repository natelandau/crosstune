"""Stand-ins for ffprobe and ffmpeg, so job tests check orchestration without decoding audio.

A fake audio file is one line of JSON naming the facts `probe` reports, padded to the size
its bit rate and length give. Every fake reads and writes that line, and `probe` hands any
other file to the real ffprobe, so a test can mix fake and real files.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING

from crosstune.jobs import audio_rewrite, media, recording_peaks, reencode, transcode
from crosstune.jobs import peaks as peaks_module
from crosstune.jobs.handlers import mono as mono_handler
from crosstune.jobs.media import MAX_PLAYBACK_CHANNELS, MediaError, Probe, playback_bitrate
from crosstune.jobs.peaks import PEAKS_PER_SECOND, encode_peaks

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    import pytest

_MARKER = b'{"fake_audio":'
_MP4_FORMATS = frozenset({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"})


@dataclass(frozen=True)
class FakeAudio:
    """The facts a fake audio file carries, the ones transcode, trim, and reencode decide on."""

    codec: str
    format_names: frozenset[str]
    bit_rate: int | None
    duration_ms: int
    channels: int
    sample_rate: int = 44_100

    def write(self, path: Path) -> Path:
        """Write this audio as a fake file at `path`, sized as its bit rate and length give.

        Args:
            path: Where the file goes.

        Returns:
            Path: `path`, so a caller can build a fixture in one expression.
        """
        header = json.dumps(
            {
                "fake_audio": True,
                "codec": self.codec,
                "format_names": sorted(self.format_names),
                "bit_rate": self.bit_rate,
                "duration_ms": self.duration_ms,
                "channels": self.channels,
                "sample_rate": self.sample_rate,
            }
        ).encode()
        size = (self.bit_rate or 0) * self.duration_ms // 8000
        path.write_bytes(header + b"\n" + bytes(max(0, size - len(header) - 1)))
        return path

    def probe(self) -> Probe:
        """Report this audio the way `media.probe` would."""
        return Probe(
            codec=self.codec,
            format_names=self.format_names,
            bit_rate=self.bit_rate,
            duration_ms=self.duration_ms,
            channels=self.channels,
            sample_rate=self.sample_rate,
        )


# The fixtures `media_fixtures` encodes, by the same names, with the rates ffprobe reports.
FAKE_SOURCES: dict[str, FakeAudio] = {
    "m4a": FakeAudio("aac", _MP4_FORMATS, 64_000, 2000, 1),
    "m4a_high": FakeAudio("aac", _MP4_FORMATS, 256_000, 2000, 1),
    "m4a_stereo": FakeAudio("aac", _MP4_FORMATS, 256_000, 2000, 2),
    "wav": FakeAudio("pcm_s16le", frozenset({"wav"}), 705_600, 2000, 1),
    "wav_stereo": FakeAudio("pcm_s16le", frozenset({"wav"}), 1_411_200, 2000, 2),
}


def read_fake(path: Path) -> FakeAudio | None:
    """Read the facts of a fake audio file, or None for any other file.

    Args:
        path: A local file.

    Returns:
        FakeAudio | None: The facts, or None when `path` is not a fake audio file.
    """
    with path.open("rb") as file:
        line = file.readline()
    if not line.startswith(_MARKER):
        return None
    fields = json.loads(line)
    return FakeAudio(
        codec=fields["codec"],
        format_names=frozenset(fields["format_names"]),
        bit_rate=fields["bit_rate"],
        duration_ms=fields["duration_ms"],
        channels=fields["channels"],
        sample_rate=fields["sample_rate"],
    )


def _require_fake(path: Path) -> FakeAudio:
    audio = read_fake(path)
    if audio is None:
        msg = f"{path} is not a fake audio file"
        raise MediaError(msg)
    return audio


def _playback(source: FakeAudio, duration_ms: int) -> FakeAudio:
    """What an encode to the playback profile writes from `source`."""
    channels = min(source.channels, MAX_PLAYBACK_CHANNELS)
    return FakeAudio(
        codec="aac",
        format_names=_MP4_FORMATS,
        bit_rate=playback_bitrate(source.channels, source.bit_rate),
        duration_ms=duration_ms,
        channels=channels,
        sample_rate=source.sample_rate,
    )


def _capped(duration_ms: int, max_ms: int | None) -> int:
    return duration_ms if max_ms is None else min(duration_ms, max_ms)


async def probe(path: Path) -> Probe:
    """Probe a fake audio file, or hand any other file to the real ffprobe.

    Args:
        path: A local file.

    Returns:
        Probe: The facts the transcoder decides on.
    """
    audio = read_fake(path)
    return await media.probe(path) if audio is None else audio.probe()


async def fake_probe(path: Path) -> Probe:
    """Probe a fake audio file, and fail on any other file as ffprobe fails on junk."""
    return _require_fake(path).probe()


async def encode(
    source: Path,
    target: Path,
    *,
    info: Probe | None = None,
    max_ms: int | None = None,
    stalls: object = None,
) -> None:
    """Write the playback encode of a fake source, as `media.encode` does."""
    audio = _require_fake(source)
    _playback(audio, _capped(audio.duration_ms, max_ms)).write(target)


async def remux(source: Path, target: Path, *, max_ms: int | None = None) -> None:
    """Rewrite a fake source's container to MP4, as `media.remux` does."""
    audio = _require_fake(source)
    FakeAudio(
        codec=audio.codec,
        format_names=_MP4_FORMATS,
        bit_rate=audio.bit_rate,
        duration_ms=_capped(audio.duration_ms, max_ms),
        channels=audio.channels,
        sample_rate=audio.sample_rate,
    ).write(target)


async def cut(
    source: Path,
    target: Path,
    start_ms: int,
    end_ms: int,
    *,
    info: Probe | None = None,
    stalls: object = None,
) -> None:
    """Write the playback encode of a range of a fake source, as `media.cut` does."""
    audio = _require_fake(source)
    duration_ms = min(end_ms, audio.duration_ms) - start_ms
    if duration_ms <= 0:
        msg = f"range {start_ms}-{end_ms} ms is outside {audio.duration_ms} ms of audio"
        raise MediaError(msg)
    _playback(audio, duration_ms).write(target)


async def build_peaks(source: Path) -> bytes:
    """Return a silent peaks file as long as a fake source, as `peaks.build_peaks` does."""
    audio = _require_fake(source)
    return encode_peaks(bytes(audio.duration_ms * PEAKS_PER_SECOND // 1000))


async def measure_mono(source: Path) -> bool:
    """Call a fake source mono when it has one channel; a fake carries no samples to compare."""
    return _require_fake(source).channels <= 1


def install(monkeypatch: pytest.MonkeyPatch, folder: Path) -> dict[str, Path]:
    """Put the fakes in place of every media call the jobs make, and write the fake sources.

    Args:
        monkeypatch: Undoes every replacement after the test.
        folder: Where the fake sources are written.

    Returns:
        dict[str, Path]: Each name in `FAKE_SOURCES` mapped to its fake file.
    """
    fakes: dict[str, Callable[..., Awaitable[object]]] = {
        "probe": fake_probe,
        "encode": encode,
        "remux": remux,
        "cut": cut,
        "build_peaks": build_peaks,
        "measure_mono": measure_mono,
    }
    for module, names in (
        (transcode, ("probe", "encode", "remux", "cut", "build_peaks")),
        (audio_rewrite, ("probe", "cut")),
        (recording_peaks, ("probe", "build_peaks")),
        (reencode, ("probe",)),
        (peaks_module, ("build_peaks",)),
        (mono_handler, ("measure_mono",)),
    ):
        for name in names:
            monkeypatch.setattr(module, name, fakes[name])
    return {name: audio.write(folder / f"{name}.fake") for name, audio in FAKE_SOURCES.items()}
