"""Check the analytics tracking plan, and keep PostHog in step with it.

`check` uses the standard library only so that it runs anywhere Python does;
`sync` and `audit` import `httpx2` when they build a client.
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

DEFAULT_PLAN = Path(__file__).parent / "tracking-plan.json"
DEFAULT_ENV = Path(__file__).parent / ".env"
POSTHOG_HOST = "https://us.posthog.com"
KEY_VAR = "POSTHOG_DEFINITIONS_KEY"
PROJECT_VAR = "POSTHOG_PROJECT_ID"
# PostHog caps a query without a LIMIT at 100 rows, which would read as events never seen.
SEEN_EVENTS_QUERY = (
    "SELECT DISTINCT event FROM events "
    "WHERE timestamp > now() - INTERVAL 30 DAY LIMIT 10000"
)

CLIENTS = {"site", "apple", "web"}
# The keys a person property adds to the setting it mirrors.
PERSON_ONLY_KEYS = {"set", "clients", "answers"}
# A setting_value takes its type from the settings table, by the setting it travels with.
TYPES = {"string", "string_list", "bool", "number", "uuid", "setting_value"}
SET_MODES = {"once", "always"}
# "free" is PostHog's own acquisition data, which no client composes.
FORMATS = {"iso8601", "version", "free"}
SNAKE_CASE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
FREE_KEYS = re.compile(r"^(\$|utm_)")
SECTIONS = (
    "buckets",
    "enums",
    "super_properties",
    "person_properties",
    "settings",
    "questions",
    "events",
)


def _is_name(value: object) -> bool:
    return isinstance(value, str) and bool(value)


def _check_values(kind: str, table: dict, problems: list[str]) -> None:
    for name, values in table.items():
        if not SNAKE_CASE.match(name):
            problems.append(f"{kind} {name!r}: name is not snake_case")
        if not isinstance(values, list) or not values:
            problems.append(f"{kind} {name!r}: values must be a non-empty list")
        elif not all(_is_name(v) for v in values):
            problems.append(f"{kind} {name!r}: every value must be a non-empty string")
        elif len(set(values)) != len(values):
            problems.append(f"{kind} {name!r}: duplicate values")


def _check_answers(
    where: str, answers: object, plan: dict, problems: list[str]
) -> None:
    problems.extend(
        f"{where}: answers unknown question {a!r}"
        for a in answers
        if not _is_name(a) or a not in plan["questions"]
    )


def _check_clients(where: str, clients: object, problems: list[str]) -> None:
    if not isinstance(clients, list) or not clients:
        problems.append(f"{where}: clients must be a non-empty list")
        return
    problems.extend(
        f"{where}: unknown client {c!r}"
        for c in clients
        if not _is_name(c) or c not in CLIENTS
    )


def _check_value_source(
    where: str, key: str, spec: dict, plan: dict, problems: list[str]
) -> None:
    """Check that a string-like property names exactly one source of its values."""
    sources = [name for name in ("enum", "bucket", "format") if name in spec]
    if len(sources) != 1:
        problems.append(
            f"{where}: a {spec['type']} needs exactly one of enum, bucket, or format"
        )
        return
    source = sources[0]
    value = spec[source]
    if not _is_name(value):
        problems.append(f"{where}: {source} must name one {source}, not {value!r}")
    elif source == "enum" and value not in plan["enums"]:
        problems.append(f"{where}: unknown enum {value!r}")
    elif source == "bucket" and value not in plan["buckets"]:
        problems.append(f"{where}: unknown bucket {value!r}")
    elif source == "format":
        if value not in FORMATS:
            problems.append(f"{where}: unknown format {value!r}")
        elif value == "free" and not FREE_KEYS.match(key):
            problems.append(
                f"{where}: format free is allowed only on $ and utm_ properties"
            )


def _check_property(
    where: str, key: str, spec: object, plan: dict, problems: list[str]
) -> bool:
    """Check one property's spec, and return whether it is an object worth reading further."""
    if not isinstance(spec, dict):
        problems.append(f"{where}: must be an object")
        return False
    if not FREE_KEYS.match(key) and not SNAKE_CASE.match(key):
        problems.append(f"{where}: name is not snake_case")
    kind = spec.get("type")
    if not _is_name(kind) or kind not in TYPES:
        problems.append(f"{where}: unknown type {kind!r}")
        return True
    if kind in {"string", "string_list"}:
        _check_value_source(where, key, spec, plan, problems)
    else:
        extras = [name for name in ("enum", "bucket", "format") if name in spec]
        if extras:
            problems.append(f"{where}: a {kind} takes no {extras[0]}")
    if kind == "uuid" and not key.endswith("_id"):
        problems.append(f"{where}: a uuid property name must end in _id")
    if "required" in spec and not isinstance(spec["required"], bool):
        problems.append(f"{where}: required must be true or false")
    if "description" in spec and not _is_name(spec["description"]):
        problems.append(f"{where}: a description must be non-empty text")
    return True


def _check_setting_value(where: str, properties: dict, problems: list[str]) -> None:
    """Check that a setting_value travels beside the setting that gives it its type."""
    setting = properties.get("setting")
    if not isinstance(setting, dict) or setting.get("enum") != "setting":
        problems.append(
            f"{where}: a setting_value needs a 'setting' property drawn from enum 'setting'"
        )


def _check_event(name: str, event: object, plan: dict, problems: list[str]) -> None:
    where = f"event {name!r}"
    if not isinstance(event, dict):
        problems.append(f"{where}: must be an object")
        return
    builtin = event.get("builtin") is True
    if not builtin and not name.startswith("$") and not SNAKE_CASE.match(name):
        problems.append(f"{where}: name is not snake_case")
    if not event.get("description"):
        problems.append(f"{where}: missing description")
    _check_clients(where, event.get("clients"), problems)
    answers = event.get("answers")
    if not isinstance(answers, list) or not answers:
        problems.append(f"{where}: answers must be a non-empty list")
    else:
        _check_answers(where, answers, plan, problems)
    properties = event.get("properties", {})
    if builtin and properties:
        problems.append(f"{where}: a builtin event has no properties")
    if not isinstance(properties, dict):
        problems.append(f"{where}: properties must be an object")
        return
    for key, spec in properties.items():
        prop_where = f"{where} property {key!r}"
        if (
            _check_property(prop_where, key, spec, plan, problems)
            and spec.get("type") == "setting_value"
        ):
            _check_setting_value(prop_where, properties, problems)


def _check_settings(plan: dict, problems: list[str]) -> None:
    settings = plan["settings"]
    person = plan["person_properties"]
    for name, spec in settings.items():
        where = f"setting {name!r}"
        if not _check_property(where, name, spec, plan, problems):
            continue
        if spec.get("type") == "setting_value":
            problems.append(f"{where}: a setting cannot take a setting_value")
        mirror = person.get(f"setting_{name}")
        if mirror is None:
            problems.append(f"setting {name!r}: no person property setting_{name}")
        elif not isinstance(mirror, dict):
            continue
        elif {k: v for k, v in mirror.items() if k not in PERSON_ONLY_KEYS} != spec:
            problems.append(
                f"person property 'setting_{name}' differs from setting {name!r}"
            )
    problems.extend(
        f"person property {key!r}: no setting {key.removeprefix('setting_')!r}"
        for key in person
        if key.startswith("setting_") and key.removeprefix("setting_") not in settings
    )
    listed = plan["enums"].get("setting")
    takes_values = any(
        isinstance(event, dict)
        and isinstance(event.get("properties"), dict)
        and any(
            isinstance(spec, dict) and spec.get("type") == "setting_value"
            for spec in event["properties"].values()
        )
        for event in plan["events"].values()
    )
    if takes_values and (not settings or listed is None):
        problems.append(
            "a setting_value needs a non-empty settings table and enum 'setting'"
        )
    if (
        isinstance(listed, list)
        and all(_is_name(v) for v in listed)
        and set(listed) != set(settings)
    ):
        problems.append("enum 'setting' must list exactly the settings")


def _check_questions(plan: dict, problems: list[str]) -> None:
    for key, text in plan["questions"].items():
        if not SNAKE_CASE.match(key):
            problems.append(f"question {key!r}: key is not snake_case")
        if not _is_name(text):
            problems.append(f"question {key!r}: needs its question as text")
    answered = {
        a
        for owner in (*plan["events"].values(), *plan["person_properties"].values())
        if isinstance(owner, dict) and isinstance(owner.get("answers"), list)
        for a in owner["answers"]
        if _is_name(a)
    }
    problems.extend(
        f"question {key!r}: nothing answers it"
        for key in plan["questions"]
        if key not in answered
    )


def check(path: Path) -> list[str]:
    """Return one line per problem in the plan at `path`."""
    try:
        plan = json.loads(Path(path).read_text())
    except OSError as error:
        return [f"the plan could not be read: {error}"]
    except json.JSONDecodeError as error:
        return [f"the plan is not valid JSON: {error}"]
    if not isinstance(plan, dict):
        return ["the plan must be a JSON object"]
    problems: list[str] = []
    if plan.get("version") != 1:
        problems.append("version must be 1")
    clients = plan.get("clients")
    if (
        not isinstance(clients, list)
        or not all(_is_name(c) for c in clients)
        or set(clients) != CLIENTS
    ):
        problems.append(f"clients must be exactly {sorted(CLIENTS)}")
    problems.extend(
        f"{section} must be an object"
        for section in SECTIONS
        if not isinstance(plan.get(section), dict)
    )
    if problems:
        return problems

    _check_values("bucket", plan["buckets"], problems)
    _check_values("enum", plan["enums"], problems)

    for key, spec in plan["super_properties"].items():
        where = f"super property {key!r}"
        if _check_property(where, key, spec, plan, problems):
            _check_clients(where, spec.get("clients"), problems)

    for key, spec in plan["person_properties"].items():
        where = f"person property {key!r}"
        if not _check_property(where, key, spec, plan, problems):
            continue
        if spec.get("type") == "setting_value":
            problems.append(f"{where}: a person property cannot take a setting_value")
        if not _is_name(spec.get("set")) or spec["set"] not in SET_MODES:
            problems.append(f"{where}: set must be once or always")
        clients = spec.get("clients")
        _check_clients(where, clients, problems)
        if isinstance(clients, list) and "site" in clients:
            problems.append(f"{where}: the site sets no person properties")
        answers = spec.get("answers")
        if answers is not None:
            if isinstance(answers, list):
                _check_answers(where, answers, plan, problems)
            else:
                problems.append(f"{where}: answers must be a list")

    _check_settings(plan, problems)
    _check_questions(plan, problems)

    for name, event in plan["events"].items():
        _check_event(name, event, plan, problems)
    return problems


def _check_command(args: argparse.Namespace) -> int:
    problems = check(args.path)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


class Client(Protocol):
    """The slice of `httpx2.Client` that `sync` and `audit` use."""

    def get(self, url: str, *, params: dict | None = None) -> "Response": ...

    def post(self, url: str, *, json: dict) -> "Response": ...

    def patch(self, url: str, *, json: dict) -> "Response": ...


class Response(Protocol):
    status_code: int

    def raise_for_status(self) -> object: ...

    def json(self) -> dict: ...


def load_env(path: Path | None = None) -> dict[str, str]:
    """Read the PostHog settings from `path`, letting real environment variables win."""
    values: dict[str, str] = {}
    env_file = DEFAULT_ENV if path is None else path
    if env_file.is_file():
        for raw in env_file.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            values[name.strip()] = value.strip().strip("\"'")
    for name in (KEY_VAR, PROJECT_VAR):
        if os.environ.get(name):
            values[name] = os.environ[name]
    return values


def make_client(env: dict[str, str]) -> "Client":
    """Build the authenticated PostHog client from the loaded settings."""
    import httpx2

    return httpx2.Client(
        base_url=POSTHOG_HOST,
        headers={"Authorization": f"Bearer {env[KEY_VAR]}"},
        timeout=30,
    )


def _tags(event: dict) -> list[str]:
    product = "site" if event["clients"] == ["site"] else "app"
    return [f"product:{product}", *event["clients"]]


def _find_definition(client: Client, base: str, name: str) -> str | None:
    """Return the ID of the definition named exactly `name`, reading every page of the search."""
    response = client.get(base, params={"search": name, "limit": 100})
    while True:
        response.raise_for_status()
        page = response.json()
        for definition in page["results"]:
            if definition["name"] == name:
                return definition["id"]
        if not page.get("next"):
            return None
        response = client.get(page["next"])


@dataclass
class SyncResult:
    """What `sync` did: definitions updated and created, and each event it could not sync."""

    updated: int = 0
    created: int = 0
    failed: list[tuple[str, int]] = field(default_factory=list)


def _raise_unless_per_event(error: Exception) -> None:
    """Re-raise a failure that would fail every event alike, so sync stops at the first."""
    import httpx2

    if not isinstance(error, httpx2.HTTPStatusError):
        raise error
    if error.response.status_code in {401, 403}:
        raise error


def _sync_event(
    client: Client, base: str, name: str, event: dict, result: SyncResult
) -> None:
    definition_id = _find_definition(client, base, name)
    if definition_id is None:
        response = client.post(base, json={"name": name})
        response.raise_for_status()
        definition_id = response.json()["id"]
        created = True
    else:
        created = False
    response = client.patch(
        f"{base}{definition_id}/",
        json={
            "description": event["description"],
            "tags": _tags(event),
            "verified": True,
        },
    )
    response.raise_for_status()
    if created:
        result.created += 1
    else:
        result.updated += 1


def sync(plan: dict, client: Client, *, project_id: str) -> SyncResult:
    """Push each planned event's description and tags to PostHog and mark it verified.

    Built-in events are skipped because PostHog owns their definitions. An event PostHog
    refuses is recorded and the rest carry on; a rejected key or a network failure stops the
    run, since every later event would fail the same way.

    Returns:
        SyncResult: The counts of definitions updated and created, and each failed event with
            its HTTP status.
    """
    import httpx2

    base = f"/api/projects/{project_id}/event_definitions/"
    result = SyncResult()
    for name, event in plan["events"].items():
        if event.get("builtin") is True:
            continue
        try:
            _sync_event(client, base, name, event, result)
        except httpx2.HTTPStatusError as error:
            _raise_unless_per_event(error)
            result.failed.append((name, error.response.status_code))
    return result


def audit(
    plan: dict, client: Client, *, project_id: str
) -> tuple[list[str], list[str]]:
    """List events PostHog saw in the last 30 days that the plan lacks, and the reverse.

    Returns:
        tuple[list[str], list[str]]: Seen but unplanned names, then planned but unseen names.
    """
    response = client.post(
        f"/api/projects/{project_id}/query/",
        json={"query": {"kind": "HogQLQuery", "query": SEEN_EVENTS_QUERY}},
    )
    response.raise_for_status()
    seen = {row[0] for row in response.json()["results"]}
    builtin = {n for n, e in plan["events"].items() if e.get("builtin") is True}
    planned = set(plan["events"]) - builtin
    unplanned = sorted(
        n for n in seen if not n.startswith("$") and n not in plan["events"]
    )
    unseen = sorted(planned - seen)
    return unplanned, unseen


def _readable_events(path: Path) -> bool:
    """Return whether the plan parses with an events table `audit` can read."""
    try:
        plan = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    return (
        isinstance(plan, dict)
        and isinstance(plan.get("events"), dict)
        and all(isinstance(event, dict) for event in plan["events"].values())
    )


def _remote_command(args: argparse.Namespace) -> int:
    problems = check(args.plan)
    if problems and (args.command == "sync" or not _readable_events(args.plan)):
        for problem in problems:
            print(problem)
        print(f"{args.command} refused: fix the plan first", file=sys.stderr)
        return 1

    env = load_env()
    missing = [name for name in (KEY_VAR, PROJECT_VAR) if not env.get(name)]
    if missing:
        print(
            f"missing {', '.join(missing)}: set it in analytics/.env or the environment",
            file=sys.stderr,
        )
        return 2

    import httpx2

    plan = json.loads(args.plan.read_text())
    client = make_client(env)
    project_id = env[PROJECT_VAR]
    try:
        if args.command == "sync":
            return _print_sync(sync(plan, client, project_id=project_id))
        return _print_audit(*audit(plan, client, project_id=project_id))
    except httpx2.HTTPStatusError as error:
        status = error.response.status_code
        if status in {401, 403}:
            print(
                f"PostHog refused the key (HTTP {status}): check {KEY_VAR}",
                file=sys.stderr,
            )
        else:
            print(f"PostHog answered HTTP {status}", file=sys.stderr)
        return 2
    except httpx2.RequestError as error:
        # The error's own text can carry the request, so only its kind is printed.
        print(f"could not reach PostHog: {type(error).__name__}", file=sys.stderr)
        return 2


def _print_sync(result: SyncResult) -> int:
    for name, status in result.failed:
        print(f"{name}: HTTP {status}")
    print(
        f"updated {result.updated} definitions, created {result.created}, "
        f"failed {len(result.failed)}"
    )
    return 1 if result.failed else 0


def _print_audit(unplanned: list[str], unseen: list[str]) -> int:
    print("Seen in the last 30 days but not in the plan:")
    print("\n".join(f"  {name}" for name in unplanned) or "  none")
    print("In the plan but never seen:")
    print("\n".join(f"  {name}" for name in unseen) or "  none")
    return 1 if unplanned or unseen else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tracking plan tools")
    commands = parser.add_subparsers(dest="command", required=True)
    check_parser = commands.add_parser("check", help="validate the plan file")
    check_parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PLAN)
    check_parser.set_defaults(run=_check_command)
    for name, text in (
        ("sync", "push definitions to PostHog"),
        ("audit", "compare PostHog with the plan"),
    ):
        remote = commands.add_parser(name, help=text)
        remote.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
        remote.set_defaults(run=_remote_command)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
