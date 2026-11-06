"""Tests for the `just dev` port check."""

import io
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from dev_ports import System, check_ports

REPO = Path("/repo")


@dataclass
class FakeSystem(System):
    """A process table the test sets up, with answers it scripts."""

    holders: dict[str, list[int]] = field(default_factory=dict)
    cwds: dict[int, str] = field(default_factory=dict)
    parents: dict[int, int] = field(default_factory=dict)
    commands: dict[int, str] = field(default_factory=dict)
    tty: bool = True
    answers: list[str | None] = field(default_factory=list)
    stubborn: bool = False
    killed: list[int] = field(default_factory=list)
    prompts: list[str] = field(default_factory=list)

    def listening_pids(self, port):
        return self.holders.get(port, [])

    def cwd(self, pid):
        return self.cwds.get(pid, "")

    def parent(self, pid):
        return self.parents.get(pid)

    def command(self, pid):
        return self.commands.get(pid, "")

    def describe(self, pids):
        return "".join(f"{pid} {self.commands.get(pid, '')}\n" for pid in pids)

    def kill(self, pids):
        self.killed.extend(pids)
        if not self.stubborn:
            for port, holding in self.holders.items():
                self.holders[port] = [pid for pid in holding if pid not in pids]

    def stdin_is_tty(self):
        return self.tty

    def ask(self, prompt):
        self.prompts.append(prompt)
        return self.answers.pop(0)

    def sleep(self, seconds):
        pass


def run(system: FakeSystem, *ports: str) -> tuple[int, str]:
    err = io.StringIO()
    code = check_ports(list(ports), system=system, repo=REPO, err=err)
    return code, err.getvalue()


def leftover(**overrides) -> FakeSystem:
    """A uvicorn from the main checkout whose honcho has gone."""
    system = FakeSystem(
        holders={"8000": [41]},
        cwds={41: "/repo/api"},
        parents={41: 1},
        commands={41: "uvicorn"},
    )
    for name, value in overrides.items():
        setattr(system, name, value)
    return system


def live_session(**overrides) -> FakeSystem:
    """A uvicorn from a worktree under a running honcho."""
    system = FakeSystem(
        holders={"8000": [41]},
        cwds={41: "/repo/.worktrees/x/api"},
        parents={41: 30, 30: 20, 20: 1},
        commands={41: "uvicorn", 30: "bash", 20: "python honcho start"},
    )
    for name, value in overrides.items():
        setattr(system, name, value)
    return system


def test_free_ports_pass():
    assert run(FakeSystem(), "8000", "5173") == (0, "")


def test_foreign_holder_fails_without_asking():
    system = FakeSystem(holders={"5173": [7]}, cwds={7: "/elsewhere"}, commands={7: "vite"})
    code, err = run(system, "5173")
    assert code == 1
    assert "port 5173 is already in use:\n  7 vite\n" in err
    assert "not a Crosstune server; stop it or free port 5173" in err
    assert system.prompts == []


def test_sibling_folder_with_the_repo_as_prefix_is_foreign():
    system = FakeSystem(holders={"8000": [7]}, cwds={7: "/repo-other/api"})
    assert run(system, "8000")[0] == 1


def test_one_foreign_holder_makes_the_port_foreign():
    system = FakeSystem(holders={"8000": [7, 8]}, cwds={7: "/repo/api", 8: "/elsewhere"})
    code, err = run(system, "8000")
    assert code == 1
    assert "not a Crosstune server" in err


@pytest.mark.parametrize("answer", ["", "y", "Yes"])
def test_leftover_stops_on_yes_or_default(answer):
    system = leftover(answers=[answer])
    code, err = run(system, "8000")
    assert code == 0
    assert "left over from an earlier session" in err
    assert system.prompts == ["stop it and continue? [Y/n] "]
    assert system.killed == [41]


def test_leftover_kept_on_no():
    system = leftover(answers=["n"])
    assert run(system, "8000")[0] == 1
    assert system.killed == []


def test_end_of_input_answers_no():
    system = leftover(answers=[None])
    code, err = run(system, "8000")
    assert code == 1
    assert err.endswith("\n\n")
    assert system.killed == []


def test_live_session_defaults_to_no():
    system = live_session(answers=[""])
    code, err = run(system, "8000")
    assert code == 1
    assert "running 'just dev' (honcho pid 20)" in err
    assert system.prompts == ["stop that session and continue? [y/N] "]
    assert system.killed == []


def test_live_session_stops_its_honcho_too():
    system = live_session(answers=["y"])
    assert run(system, "8000")[0] == 0
    assert system.killed == [41, 20]


def test_without_a_terminal_prints_the_kill_command():
    system = leftover(tty=False, holders={"8000": [41, 42]}, cwds={41: "/repo", 42: "/repo"})
    code, err = run(system, "8000")
    assert code == 1
    assert "stop it with: kill 41 42\n" in err
    assert system.killed == []


def test_port_still_held_after_kill_fails():
    system = leftover(answers=["y"], stubborn=True)
    code, err = run(system, "8000")
    assert code == 1
    assert "port 8000 is still held after stopping 41" in err


def test_every_port_is_checked_after_one_fails():
    system = FakeSystem(holders={"8000": [7], "4321": [9]}, cwds={7: "/elsewhere", 9: "/repo/site"})
    system.answers = ["y"]
    system.parents = {9: 1}
    code, err = run(system, "8000", "4321")
    assert code == 1
    assert "port 4321 is already in use" in err
    assert system.killed == [9]
