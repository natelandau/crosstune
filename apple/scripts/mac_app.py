#!/usr/bin/env python3
"""Run the Debug Mac app from one fixed path, shared by every checkout and worktree.

Usage: mac_app.py run [app args...] | done | status

The login keychain trusts an app by its path and signature, so a build launched from its own
DerivedData asks for the keychain password once per Clerk item in every new worktree.

A worktree holds a lease from `run` until `done`, across as many commands as its checks
take. Builds run in parallel; only installing and running the app waits its turn, oldest
waiter first. A lease whose worktree is gone, or that no `run` has renewed in LEASE_TTL
seconds, is taken over so a crashed session can't block the rest.

The state folder's layout is shared with older checkouts that still run this tool as a
shell script, so its files and formats must not change.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

USAGE = "usage: mac_app.py run [app args...] | done | status"
STATE = Path.home() / "Library/Caches/crosstune/mac-app"
DEFAULT_TTL = 900
# Command-line markers of this tool, in either of its forms, for telling a live waiter from
# a reused pid.
TOOL_MARKERS = ("mac-app.sh", "mac_app.py")
WAIT_SECONDS = 2.0


def is_tool_process(pid: int) -> bool:
    """Report whether `pid` still runs this tool, so a ticket of a dead waiter can be dropped.

    A reused pid would otherwise hold the head of the queue forever.

    Args:
        pid: The process ID a queue ticket names.

    Returns:
        bool: True when the process exists and its command line names this tool.
    """
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, check=False
    )
    return any(marker in result.stdout for marker in TOOL_MARKERS)


class Lease:
    """The shared claim on the installed app, and the queue of worktrees waiting for it."""

    def __init__(
        self,
        *,
        state: Path,
        me: str,
        clock: Callable[[], int] = lambda: int(time.time()),
        is_alive: Callable[[int], bool] = is_tool_process,
        sleep: Callable[[float], None] = time.sleep,
        ttl: int = DEFAULT_TTL,
        pid: int | None = None,
    ) -> None:
        self.state = state
        self.me = me
        self.clock = clock
        self.is_alive = is_alive
        self.sleep = sleep
        self.ttl = ttl
        self.pid = os.getpid() if pid is None else pid

    @property
    def lease(self) -> Path:
        """The folder whose existence is the lock."""
        return self.state / "lease"

    @property
    def queue(self) -> Path:
        """The folder of waiting worktrees' tickets."""
        return self.state / "queue"

    def owner(self, lease: Path | None = None) -> str:
        """Read the path of the worktree that holds `lease`, or an empty string."""
        try:
            return (lease or self.lease).joinpath("owner").read_text().rstrip("\n")
        except FileNotFoundError:
            return ""

    def renewed(self, lease: Path | None = None) -> int:
        """Read when `lease` was last renewed, in epoch seconds, or 0 when it never was."""
        try:
            text = (lease or self.lease).joinpath("renewed").read_text().strip()
        except FileNotFoundError:
            return 0
        return int(text) if text.isdigit() else 0

    def renew(self) -> None:
        """Stamp the lease with the current time.

        Written aside and renamed, so a reader never sees the file empty.
        """
        staged = self.lease / "renewed.tmp"
        staged.write_text(f"{self.clock()}\n")
        staged.replace(self.lease / "renewed")

    def stale(self, lease: Path | None = None) -> bool:
        """Report whether `lease` may be taken over: its worktree is gone or its TTL passed."""
        holder = self.owner(lease)
        if not holder or not Path(holder).is_dir():
            return True
        return self.clock() - self.renewed(lease) > self.ttl

    def held(self) -> bool:
        """Report whether this worktree holds the lease, renewing it when it does.

        Renewing fails once the lease has moved, so a holder that lost it queues instead.
        """
        if self.owner() != self.me:
            return False
        try:
            self.renew()
        except OSError:
            return False
        return True

    def live_tickets(self) -> Iterator[str]:
        """Yield the tickets of live waiters in arrival order, deleting the dead ones' tickets.

        A ticket is named for its arrival time and its waiter's pid, so name order is
        arrival order.
        """
        if not self.queue.is_dir():
            return
        for path in sorted(self.queue.iterdir()):
            pid = path.name.partition("-")[2]
            if pid.isdigit() and self.is_alive(int(pid)):
                yield path.name
            else:
                path.unlink(missing_ok=True)

    def claim(self) -> None:
        """Wait until this worktree holds the lease, taking over a stale one in turn."""
        if self.held():
            return
        self.queue.mkdir(parents=True, exist_ok=True)
        ticket = self.queue / f"{self.clock()}-{self.pid}"
        ticket.touch()
        shown = ""
        try:
            while True:
                if self.held():
                    return
                # Only the oldest waiter contends, so a stale lease has one taker.
                if next(self.live_tickets(), None) == ticket.name:
                    self._take_over_if_stale()
                    if self._create():
                        return
                holder = self.owner()
                # Empty while a new holder is still writing its name.
                if holder and holder != shown:
                    print(f"waiting for the Mac app: held by {holder}")
                    shown = holder
                self.sleep(WAIT_SECONDS)
        finally:
            ticket.unlink(missing_ok=True)

    def _take_over_if_stale(self) -> None:
        if not (self.lease.is_dir() and self.stale()):
            return
        # Moved aside before the final check, so a holder renewing in between either lands
        # first and keeps the lease, or finds it gone and queues.
        aside = self.state / f"stale.{self.pid}"
        try:
            self.lease.rename(aside)
        except OSError:
            return
        if self.stale(aside):
            print(f"taking over the lease from {self.owner(aside)} (stale)")
            shutil.rmtree(aside)
        else:
            aside.rename(self.lease)

    def _create(self) -> bool:
        try:
            self.lease.mkdir()
        except FileExistsError:
            return False
        (self.lease / "owner").write_text(f"{self.me}\n")
        self.renew()
        return True

    def release(self) -> None:
        """Delete the lease so the next waiter can claim it."""
        shutil.rmtree(self.lease, ignore_errors=True)

    def status(self) -> str:
        """Describe who holds the lease and how many worktrees wait for it."""
        if self.lease.is_dir():
            age = self.clock() - self.renewed()
            suffix = ", stale" if self.stale() else ""
            line = f"held by {self.owner()}, renewed {age}s ago{suffix}"
        else:
            line = "free"
        return f"{line}\n{sum(1 for _ in self.live_tickets())} waiting"


class MacApp:
    """The installed Debug app: building, installing, launching, and quitting it."""

    def __init__(self, *, me: str, lease: Lease) -> None:
        self.me = me
        self.lease = lease
        self.apple = Path(me) / "apple"
        # Apart from `just apple::build`, whose unsigned Debug products fail the signed build
        self.derived = self.apple / ".build/RunDerivedData"
        applications = Path.home() / "Applications"
        applications.mkdir(parents=True, exist_ok=True)
        # Resolved, since quitting matches the process path and ~/Applications may be a link
        self.dest = applications.resolve() / "Crosstune Dev.app"

    def run(self, app_args: list[str]) -> int:
        """Build the signed app, wait for the lease, then install and launch it."""
        # Signed, so the keychain sees the same identity from every worktree
        build = subprocess.run(
            [
                str(self.apple / "scripts/scrub-env.sh"),
                "xcodebuild",
                "build",
                "-quiet",
                "-project",
                str(self.apple / "Crosstune.xcodeproj"),
                "-scheme",
                "Crosstune",
                "-configuration",
                "Debug",
                "-destination",
                "platform=macOS",
                "-derivedDataPath",
                str(self.derived),
            ],
            check=False,
        )
        if build.returncode != 0:
            return build.returncode
        self.lease.claim()
        self.quit()
        shutil.rmtree(self.dest, ignore_errors=True)
        subprocess.run(
            ["ditto", str(self.derived / "Build/Products/Debug/Crosstune.app"), str(self.dest)],
            check=True,
        )
        subprocess.run(["open", "-g", "-n", str(self.dest), "--args", *app_args], check=True)
        print(f"running {self.dest} for {self.me}; finish with: just apple::done")
        return 0

    def quit(self) -> None:
        """Quit the installed app, and kill it when it does not quit in 10 seconds."""
        pattern = f"^{self.dest}/Contents/MacOS/"
        subprocess.run(["pkill", "-f", pattern], capture_output=True, check=False)
        for _ in range(50):
            if subprocess.run(
                ["pgrep", "-f", pattern], capture_output=True, check=False
            ).returncode:
                return
            time.sleep(0.2)
        subprocess.run(["pkill", "-9", "-f", pattern], capture_output=True, check=False)

    def done(self) -> None:
        """Quit the app and release the lease, when this worktree holds it."""
        holder = self.lease.owner()
        if holder != self.me:
            print(f"this worktree does not hold the Mac app (holder: {holder})")
            return
        self.quit()
        self.lease.release()
        print("released the Mac app")


def main(argv: list[str]) -> int:
    """Dispatch the subcommand in `argv`."""
    if not argv or argv[0] not in {"run", "done", "status"}:
        print(USAGE, file=sys.stderr)
        return 2
    # Turned into an exit, so a killed waiter still deletes its ticket.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    me = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    ).stdout.strip()
    lease = Lease(state=STATE, me=me, ttl=int(os.environ.get("LEASE_TTL", DEFAULT_TTL)))
    command, rest = argv[0], argv[1:]
    if command == "status":
        print(lease.status())
        return 0
    app = MacApp(me=me, lease=lease)
    if command == "done":
        app.done()
        return 0
    return app.run(rest)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
