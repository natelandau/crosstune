"""Free the ports `just dev` serves on before honcho starts.

Usage: dev_ports.py PORT...

The API, web client, and site need their ports free, and honcho stops all of them the
moment one fails to bind. A server from an earlier session that outlived its terminal is
the usual holder, so this names it and offers to stop it.
"""

import subprocess
import sys
import time
from pathlib import Path
from typing import Protocol, TextIO, override

USAGE = "usage: dev_ports.py <port>..."
WAIT_POLLS = 20
WAIT_INTERVAL = 0.5


class System(Protocol):
    """The process and terminal probes the port check reads and acts through."""

    def listening_pids(self, port: str) -> list[int]:
        """Return the sorted, unique pids listening on `port`."""
        ...

    def cwd(self, pid: int) -> str:
        """Return the working directory of `pid`, or an empty string when unknown."""
        ...

    def parent(self, pid: int) -> int | None:
        """Return the parent pid of `pid`, or None when it has exited."""
        ...

    def command(self, pid: int) -> str:
        """Return the command line of `pid`."""
        ...

    def describe(self, pids: list[int]) -> str:
        """Return one line per pid with its pid, start time, and command."""
        ...

    def kill(self, pids: list[int]) -> None:
        """Send SIGTERM to every pid, ignoring ones already gone."""
        ...

    def stdin_is_tty(self) -> bool:
        """Return whether a person can answer a prompt."""
        ...

    def ask(self, prompt: str) -> str | None:
        """Show `prompt` and return the answer, or None at end of input."""
        ...

    def sleep(self, seconds: float) -> None:
        """Wait `seconds` before the next probe."""
        ...


class LocalSystem(System):
    """Probe the real machine with lsof and ps."""

    @override
    def listening_pids(self, port: str) -> list[int]:
        result = subprocess.run(
            ["lsof", f"-tiTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True, check=False
        )
        return sorted({int(line) for line in result.stdout.split()})

    @override
    def cwd(self, pid: int) -> str:
        result = subprocess.run(
            ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
            capture_output=True,
            text=True,
            check=False,
        )
        return next((line[1:] for line in result.stdout.splitlines() if line.startswith("n")), "")

    @override
    def parent(self, pid: int) -> int | None:
        result = subprocess.run(
            ["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True, check=False
        )
        value = result.stdout.strip()
        return int(value) if value else None

    @override
    def command(self, pid: int) -> str:
        result = subprocess.run(
            ["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, check=False
        )
        return result.stdout.strip()

    @override
    def describe(self, pids: list[int]) -> str:
        result = subprocess.run(
            ["ps", "-o", "pid=,lstart=,command=", "-p", ",".join(str(pid) for pid in pids)],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout

    @override
    def kill(self, pids: list[int]) -> None:
        subprocess.run(["kill", *(str(pid) for pid in pids)], capture_output=True, check=False)

    @override
    def stdin_is_tty(self) -> bool:
        return sys.stdin.isatty()

    @override
    def ask(self, prompt: str) -> str | None:
        sys.stderr.write(prompt)
        sys.stderr.flush()
        line = sys.stdin.readline()
        return line.rstrip("\n") if line else None

    @override
    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


def honcho_above(system: System, pid: int) -> int | None:
    """Return the pid of the honcho above `pid`, which only a live `just dev` still has.

    Args:
        system: The probes to read the process tree through.
        pid: The process holding a port.

    Returns:
        int | None: The honcho pid, or None for a server left over from an earlier session.
    """
    while pid > 1:
        parent = system.parent(pid)
        if parent is None:
            return None
        pid = parent
        if "honcho" in system.command(pid):
            return pid
    return None


def wait_free(system: System, port: str) -> bool:
    """Return whether `port` frees within the wait after its holders were stopped."""
    for _ in range(WAIT_POLLS):
        if not system.listening_pids(port):
            return True
        system.sleep(WAIT_INTERVAL)
    return False


def check_ports(ports: list[str], *, system: System, repo: Path, err: TextIO) -> int:
    """Offer to stop the Crosstune servers holding `ports`, and report the rest.

    Args:
        ports: The ports `just dev` needs free.
        system: The probes to read and stop processes through.
        repo: The main checkout, so a server started from any worktree counts as ours.
        err: Where messages and the listing of holders go.

    Returns:
        int: 0 when every port is free, else 1.
    """
    held = 0
    for port in ports:
        pids = system.listening_pids(port)
        if not pids:
            continue
        ours = all(f"{system.cwd(pid)}/".startswith(f"{repo}/") for pid in pids)
        live = next(
            (found for pid in pids if (found := honcho_above(system, pid)) is not None), None
        )
        listed = " ".join(str(pid) for pid in pids)

        print(f"port {port} is already in use:", file=err)
        for line in system.describe(pids).splitlines():
            print(f"  {line}", file=err)

        if not ours:
            print(
                f"that is not a Crosstune server; stop it or free port {port}, "
                "then run 'just dev' again",
                file=err,
            )
            held = 1
            continue

        if live is not None:
            print(
                f"it belongs to a running 'just dev' (honcho pid {live}); "
                "Ctrl-C that session, or stop it here",
                file=err,
            )
            prompt, default = "stop that session and continue? [y/N] ", "n"
        else:
            print("it is a Crosstune server left over from an earlier session", file=err)
            prompt, default = "stop it and continue? [Y/n] ", "y"

        if not system.stdin_is_tty():
            print(f"stop it with: kill {listed}", file=err)
            held = 1
            continue

        answer = system.ask(prompt)
        if answer is None:
            print(file=err)
            answer = "n"
        if not (answer or default).lower().startswith("y"):
            held = 1
            continue

        system.kill(pids if live is None else [*pids, live])
        if not wait_free(system, port):
            print(f"port {port} is still held after stopping {listed}", file=err)
            held = 1
    return held


def main_checkout() -> Path:
    """Return the main checkout, which every worktree shares a git directory with."""
    common = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"], capture_output=True, text=True, check=True
    ).stdout.strip()
    return Path(common).resolve().parent


def main() -> int:
    """Check the ports named on the command line."""
    ports = sys.argv[1:]
    if not ports:
        print(USAGE, file=sys.stderr)
        return 2
    return check_ports(ports, system=LocalSystem(), repo=main_checkout(), err=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
