"""Tests for the Mac app lease that every worktree shares."""

from collections.abc import Callable
from pathlib import Path

import pytest

from mac_app import Lease, MacApp


class Clock:
    """A clock the test sets by hand."""

    def __init__(self, now: int = 1_700_000_000) -> None:
        self.now = now

    def __call__(self) -> int:
        return self.now


class StopWaitingError(Exception):
    """Raised by a test's sleep to end a wait the test expects."""


def stop_waiting(_seconds: float) -> None:
    raise StopWaitingError


def make_lease(
    tmp_path: Path,
    me: Path,
    *,
    clock: Clock | None = None,
    is_alive: Callable[[int], bool] = lambda _pid: True,
    ttl: int = 900,
) -> Lease:
    me.mkdir(parents=True, exist_ok=True)
    return Lease(
        state=tmp_path / "state",
        me=str(me),
        clock=clock or Clock(),
        is_alive=is_alive,
        sleep=stop_waiting,
        ttl=ttl,
        pid=4242,
    )


def hold(lease: Lease, owner: Path, renewed: int) -> None:
    owner.mkdir(parents=True, exist_ok=True)
    lease.lease.mkdir(parents=True)
    (lease.lease / "owner").write_text(f"{owner}\n")
    (lease.lease / "renewed").write_text(f"{renewed}\n")


def test_claim_takes_a_free_lease(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    lease.claim()
    assert lease.owner() == str(tmp_path / "wt-a")
    assert (lease.lease / "owner").read_text() == f"{tmp_path / 'wt-a'}\n"
    assert lease.renewed() == 1_700_000_000
    assert list(lease.queue.iterdir()) == []


def test_claim_renews_a_lease_already_held(tmp_path):
    clock = Clock()
    lease = make_lease(tmp_path, tmp_path / "wt-a", clock=clock)
    hold(lease, tmp_path / "wt-a", renewed=10)
    lease.claim()
    assert lease.renewed() == clock.now
    assert not (lease.lease / "renewed.tmp").exists()
    assert not lease.queue.exists()


def test_claim_waits_while_a_live_worktree_holds_a_fresh_lease(tmp_path, capsys):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    hold(lease, tmp_path / "wt-b", renewed=lease.clock())
    with pytest.raises(StopWaitingError):
        lease.claim()
    assert lease.owner() == str(tmp_path / "wt-b")
    assert f"waiting for the Mac app: held by {tmp_path / 'wt-b'}" in capsys.readouterr().out
    # The waiter's ticket goes with it.
    assert list(lease.queue.iterdir()) == []


def test_claim_takes_over_a_lease_past_its_ttl(tmp_path, capsys):
    lease = make_lease(tmp_path, tmp_path / "wt-a", ttl=900)
    hold(lease, tmp_path / "wt-b", renewed=lease.clock() - 901)
    lease.claim()
    assert lease.owner() == str(tmp_path / "wt-a")
    assert f"taking over the lease from {tmp_path / 'wt-b'} (stale)" in capsys.readouterr().out
    assert not (lease.state / "stale.4242").exists()


def test_claim_takes_over_a_lease_whose_worktree_is_gone(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    hold(lease, tmp_path / "wt-b", renewed=lease.clock())
    (tmp_path / "wt-b").rmdir()
    lease.claim()
    assert lease.owner() == str(tmp_path / "wt-a")


def test_only_the_oldest_live_waiter_claims(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    lease.queue.mkdir(parents=True)
    (lease.queue / "1699999999-77").touch()
    with pytest.raises(StopWaitingError):
        lease.claim()
    assert not lease.lease.exists()
    assert [p.name for p in lease.queue.iterdir()] == ["1699999999-77"]


def test_a_waiter_whose_ticket_was_deleted_still_claims_the_freed_lease(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    hold(lease, tmp_path / "wt-b", renewed=lease.clock())
    waits = 0

    def ticket_deleted_then_lease_freed(_seconds: float) -> None:
        nonlocal waits
        waits += 1
        if waits > 1:
            raise StopWaitingError
        for ticket in lease.queue.iterdir():
            ticket.unlink()
        lease.release()

    lease.sleep = ticket_deleted_then_lease_freed
    lease.claim()
    assert lease.owner() == str(tmp_path / "wt-a")
    assert list(lease.queue.iterdir()) == []


def test_a_dead_waiters_ticket_is_dropped(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a", is_alive=lambda pid: pid != 77)
    lease.queue.mkdir(parents=True)
    (lease.queue / "1699999999-77").touch()
    lease.claim()
    assert lease.owner() == str(tmp_path / "wt-a")
    assert list(lease.queue.iterdir()) == []


def test_live_tickets_come_in_arrival_order(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a", is_alive=lambda pid: pid != 2)
    lease.queue.mkdir(parents=True)
    for name in ("300-3", "100-1", "200-2", "junk"):
        (lease.queue / name).touch()
    assert list(lease.live_tickets()) == ["100-1", "300-3"]
    assert sorted(p.name for p in lease.queue.iterdir()) == ["100-1", "300-3"]


def test_held_is_false_once_the_lease_moved(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    lease.claim()
    lease.release()
    assert not lease.held()


def test_status_of_a_free_lease(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    assert lease.status() == "free\n0 waiting"


def test_status_of_a_held_lease(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    hold(lease, tmp_path / "wt-b", renewed=lease.clock() - 30)
    lease.queue.mkdir()
    (lease.queue / "5-6").touch()
    assert lease.status() == f"held by {tmp_path / 'wt-b'}, renewed 30s ago\n1 waiting"


def test_status_marks_a_stale_lease(tmp_path):
    lease = make_lease(tmp_path, tmp_path / "wt-a", ttl=10)
    hold(lease, tmp_path / "wt-b", renewed=lease.clock() - 11)
    assert lease.status().startswith(f"held by {tmp_path / 'wt-b'}, renewed 11s ago, stale\n")


def test_done_by_a_worktree_that_does_not_hold_the_app(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    hold(lease, tmp_path / "wt-b", renewed=lease.clock())
    app = MacApp(me=str(tmp_path / "wt-a"), lease=lease)
    monkeypatch.setattr(app, "quit", lambda: pytest.fail("quit the app another worktree holds"))
    app.done()
    assert f"does not hold the Mac app (holder: {tmp_path / 'wt-b'})" in capsys.readouterr().out
    assert lease.owner() == str(tmp_path / "wt-b")


def test_done_by_the_holder_releases_the_lease(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    lease = make_lease(tmp_path, tmp_path / "wt-a")
    lease.claim()
    app = MacApp(me=str(tmp_path / "wt-a"), lease=lease)
    quits = []
    monkeypatch.setattr(app, "quit", lambda: quits.append(True))
    app.done()
    assert quits == [True]
    assert not lease.lease.exists()
    assert "released the Mac app" in capsys.readouterr().out
