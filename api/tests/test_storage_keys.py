"""Key helpers that carry a revision, so a later transcode never overwrites a live download."""

from __future__ import annotations

import re

from crosstune.storage.store import new_rev, peaks_key, playback_key, recording_prefix


def test_keys_carry_revision() -> None:
    rev = "0a1b2c3d"
    key = playback_key("u1", "r1", rev)
    assert key.startswith(recording_prefix("u1", "r1"))
    assert key.endswith("/playback-0a1b2c3d.m4a")


def test_peaks_key_carries_revision() -> None:
    rev = "0a1b2c3d"
    key = peaks_key("u1", "r1", rev)
    assert key.startswith(recording_prefix("u1", "r1"))
    assert key.endswith("/peaks-0a1b2c3d.bin")


def test_new_rev_is_eight_hex_chars() -> None:
    assert re.fullmatch(r"[0-9a-f]{8}", new_rev())
    assert new_rev() != new_rev()
