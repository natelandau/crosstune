"""A push from a client that predates part modes and tune types still lands correctly."""

from __future__ import annotations

from crosstune.sync.legacy_tune_shape import reconcile_tune


def _data(**fields) -> dict:
    base = {"feel": None, "mode": None, "tune_type": None, "modes": None, "composer": None}
    return {**base, **fields}


def test_an_old_client_type_edit_wins_over_its_pulled_copy() -> None:
    data = _data(feel="Jig", tune_type="Reel")
    out = reconcile_tune(data, sent={"feel", "tune_type"})
    assert out["tune_type"] == "Jig"
    assert out["feel"] == "Jig"


def test_an_old_client_mode_edit_keeps_later_part_modes() -> None:
    data = _data(mode="dorian", modes=["major", "minor"])
    out = reconcile_tune(data, sent={"mode", "modes"})
    assert out["modes"] == ["dorian", "minor"]
    assert out["mode"] == "dorian"


def test_an_old_client_clearing_mode_clears_every_part() -> None:
    out = reconcile_tune(_data(mode=None, modes=["major", "minor"]), sent={"mode", "modes"})
    assert out["modes"] == []


def test_an_old_client_that_never_pulled_modes_gets_one() -> None:
    out = reconcile_tune(_data(mode="minor"), sent={"mode", "feel"})
    assert out["modes"] == ["minor"]


def test_a_new_client_fills_the_old_columns() -> None:
    data = _data(tune_type="Slide", modes=["mixolydian", "major"])
    out = reconcile_tune(data, sent={"tune_type", "modes"})
    assert (out["feel"], out["mode"]) == ("Slide", "mixolydian")


def test_a_new_client_with_no_modes_stores_an_empty_list() -> None:
    out = reconcile_tune(_data(), sent={"title"})
    assert out["modes"] == []
    assert out["mode"] is None
