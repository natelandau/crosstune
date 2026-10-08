"""Tests for the tracking plan checker and for the plan file itself."""

import copy
import json
from pathlib import Path

import httpx2
import pytest

import plan as plan_module
from plan import SyncResult, audit, check, load_env, main, sync

PLAN = Path(__file__).parent / "tracking-plan.json"

BASE = {
    "version": 1,
    "clients": ["site", "apple", "web"],
    "buckets": {"count": ["0", "1-9", "10-49", "50-199", "200+"]},
    "enums": {"source": ["catalog", "tune"]},
    "super_properties": {
        "product": {
            "type": "string",
            "enum": "source",
            "clients": ["site", "apple", "web"],
        },
    },
    "person_properties": {
        "catalog_size": {"type": "string", "bucket": "count", "set": "always"},
        "signed_up_at": {"type": "string", "format": "iso8601", "set": "once"},
        "setting_audio_quality": {"type": "string", "enum": "source", "set": "always"},
    },
    "settings": {"audio_quality": {"type": "string", "enum": "source"}},
    "questions": {"activation": "Do new people reach their first practice?"},
    "events": {
        "tune_created": {
            "description": "A tune was added to the catalog.",
            "clients": ["apple", "web"],
            "answers": ["activation"],
            "properties": {
                "source": {"type": "string", "enum": "source", "required": True},
                "tune_id": {"type": "uuid", "required": True},
            },
        },
    },
}


def problems(tmp_path: Path, edit) -> list[str]:
    """Check a copy of the base plan after `edit` changes it."""
    plan = copy.deepcopy(BASE)
    edit(plan)
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan))
    return check(path)


def prop(plan: dict, key: str) -> dict:
    return plan["events"]["tune_created"]["properties"][key]


def test_the_real_plan_has_no_problems():
    assert check(PLAN) == []


def test_the_base_plan_has_no_problems(tmp_path):
    assert problems(tmp_path, lambda p: None) == []


def test_reports_a_property_naming_an_unknown_enum(tmp_path):
    found = problems(tmp_path, lambda p: prop(p, "source").update(enum="nope"))
    assert len(found) == 1
    assert "nope" in found[0]


def test_reports_a_non_snake_case_event_name(tmp_path):
    def edit(p):
        p["events"]["TuneCreated"] = p["events"].pop("tune_created")

    assert any("TuneCreated" in f for f in problems(tmp_path, edit))


def test_allows_a_builtin_event_with_any_name(tmp_path):
    def edit(p):
        p["events"]["Application Opened"] = {
            "description": "The app opened.",
            "clients": ["apple"],
            "answers": ["activation"],
            "builtin": True,
        }
        p["events"]["$screen"] = {
            "description": "A screen was shown.",
            "clients": ["apple"],
            "answers": ["activation"],
            "properties": {
                "source": {"type": "string", "enum": "source", "required": True}
            },
        }

    assert problems(tmp_path, edit) == []


def test_reports_a_builtin_event_with_properties(tmp_path):
    def edit(p):
        p["events"]["$pageview"] = {
            "description": "A page was viewed.",
            "clients": ["site"],
            "answers": ["activation"],
            "builtin": True,
            "properties": {"source": {"type": "string", "enum": "source"}},
        }

    assert any("$pageview" in f for f in problems(tmp_path, edit))


def test_reports_an_unknown_client(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["clients"] = ["android"]

    assert any("android" in f for f in problems(tmp_path, edit))


def test_reports_a_uuid_property_not_ending_in_id(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["properties"]["tune"] = {"type": "uuid"}

    assert any("tune" in f and "_id" in f for f in problems(tmp_path, edit))


def test_reports_a_string_property_with_neither_enum_nor_bucket(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["properties"]["title"] = {"type": "string"}

    assert any("title" in f for f in problems(tmp_path, edit))


def test_reports_a_null_enum(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["properties"]["to"] = {
            "type": "string",
            "enum": None,
        }

    assert any("'to'" in f and "enum" in f for f in problems(tmp_path, edit))


def add_setting_changed(plan: dict, value: dict) -> None:
    plan["enums"]["setting"] = ["audio_quality"]
    plan["events"]["setting_changed"] = {
        "description": "A setting changed.",
        "clients": ["apple"],
        "answers": ["activation"],
        "properties": {
            "setting": {"type": "string", "enum": "setting", "required": True},
            "value": value,
        },
    }


def test_accepts_a_setting_value_beside_its_setting(tmp_path):
    def edit(p):
        add_setting_changed(p, {"type": "setting_value", "required": True})

    assert problems(tmp_path, edit) == []


def test_reports_a_setting_value_without_a_setting_property(tmp_path):
    def edit(p):
        add_setting_changed(p, {"type": "setting_value", "required": True})
        del p["events"]["setting_changed"]["properties"]["setting"]

    assert any("setting_value" in f for f in problems(tmp_path, edit))


def test_reports_a_setting_value_when_the_setting_enum_is_missing(tmp_path):
    def edit(p):
        add_setting_changed(p, {"type": "setting_value", "required": True})
        del p["enums"]["setting"]

    assert any("setting" in f for f in problems(tmp_path, edit))


def test_reports_a_setting_value_with_an_enum(tmp_path):
    def edit(p):
        add_setting_changed(p, {"type": "setting_value", "enum": "source"})

    assert any("setting_value" in f for f in problems(tmp_path, edit))


def test_reports_a_setting_that_takes_a_setting_value(tmp_path):
    def edit(p):
        p["settings"]["audio_quality"] = {"type": "setting_value"}
        p["person_properties"]["setting_audio_quality"] = {
            "type": "setting_value",
            "set": "always",
        }

    assert any("audio_quality" in f for f in problems(tmp_path, edit))


def test_reports_an_answer_that_names_no_question(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["answers"] = ["activation", "nope"]

    assert any("nope" in f for f in problems(tmp_path, edit))


def test_reports_a_question_no_event_answers(tmp_path):
    def edit(p):
        p["questions"]["retention"] = "Do people come back?"

    assert any("retention" in f for f in problems(tmp_path, edit))


def test_reports_a_question_without_text_or_with_a_bad_key(tmp_path):
    def edit(p):
        p["questions"]["activation"] = ""
        p["questions"]["Bad Key"] = "Text."
        p["events"]["tune_created"]["answers"].append("Bad Key")

    found = problems(tmp_path, edit)
    assert any("'activation'" in f for f in found)
    assert any("Bad Key" in f and "snake_case" in f for f in found)


@pytest.mark.parametrize(
    ("edit", "where"),
    [
        (
            lambda p: p["super_properties"].update(product="not an object"),
            "product",
        ),
        (lambda p: prop(p, "source").update(type=["string"]), "source"),
        (lambda p: prop(p, "source").update(enum=["source"]), "source"),
        (
            lambda p: p["person_properties"].update(setting_audio_quality="x"),
            "setting_audio_quality",
        ),
        (lambda p: p["person_properties"].update(catalog_size=["x"]), "catalog_size"),
        (lambda p: p["enums"].update(source=[["catalog"], "tune"]), "source"),
        (lambda p: p["events"]["tune_created"].update(answers=[["x"]]), "answers"),
        (lambda p: p["events"]["tune_created"].update(clients=[["apple"]]), "client"),
        (lambda p: p["events"].update(tune_created=["x"]), "tune_created"),
        (lambda p: p["settings"].update(audio_quality=None), "audio_quality"),
        (lambda p: p.update(clients=[["site"]]), "clients"),
        (lambda p: p.update(questions=["activation"]), "questions"),
    ],
)
def test_reports_malformed_input_without_crashing(tmp_path, edit, where):
    found = problems(tmp_path, edit)
    assert any(where in f for f in found), found


def test_reports_a_plan_that_is_not_an_object(tmp_path):
    path = tmp_path / "plan.json"
    path.write_text("[]")
    assert check(path) == ["the plan must be a JSON object"]


def test_reports_a_plan_that_is_not_json(tmp_path):
    path = tmp_path / "plan.json"
    path.write_text("{")
    found = check(path)
    assert len(found) == 1
    assert "JSON" in found[0]


def test_reports_duplicate_enum_values(tmp_path):
    found = problems(tmp_path, lambda p: p["enums"].update(dup=["a", "a"]))
    assert any("dup" in f for f in found)


def test_reports_an_unknown_bucket(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["properties"]["n"] = {
            "type": "string",
            "bucket": "nope",
        }

    assert any("nope" in f for f in problems(tmp_path, edit))


def test_reports_free_text_on_an_ordinary_property(tmp_path):
    def edit(p):
        p["events"]["tune_created"]["properties"]["title"] = {
            "type": "string",
            "format": "free",
        }

    assert any("title" in f and "free" in f for f in problems(tmp_path, edit))


def test_allows_free_text_on_acquisition_properties(tmp_path):
    def edit(p):
        props = p["events"]["tune_created"]["properties"]
        props["$referrer"] = {"type": "string", "format": "free"}
        props["utm_source"] = {"type": "string", "format": "free"}

    assert problems(tmp_path, edit) == []


def test_reports_a_setting_without_its_person_property(tmp_path):
    def edit(p):
        del p["person_properties"]["setting_audio_quality"]

    assert any("setting_audio_quality" in f for f in problems(tmp_path, edit))


def test_reports_a_setting_person_property_that_differs_from_its_setting(tmp_path):
    def edit(p):
        p["person_properties"]["setting_audio_quality"]["enum"] = None

    assert any("setting_audio_quality" in f for f in problems(tmp_path, edit))


def test_accepts_a_property_description(tmp_path):
    def edit(p):
        p["person_properties"]["catalog_size"]["description"] = "Live tunes, bucketed."

    assert problems(tmp_path, edit) == []


def test_reports_an_empty_property_description(tmp_path):
    def edit(p):
        p["person_properties"]["catalog_size"]["description"] = ""

    assert any(
        "catalog_size" in f and "description" in f for f in problems(tmp_path, edit)
    )


def test_reports_a_person_property_with_a_bad_set(tmp_path):
    def edit(p):
        p["person_properties"]["catalog_size"]["set"] = "sometimes"

    assert any("catalog_size" in f for f in problems(tmp_path, edit))


PROJECT = "42"
EVENTS_URL = f"/api/projects/{PROJECT}/event_definitions/"
QUERY_URL = f"/api/projects/{PROJECT}/query/"


def sync_plan() -> dict:
    plan = copy.deepcopy(BASE)
    plan["events"]["list_created"] = {
        "description": "A list was created.",
        "clients": ["site"],
        "answers": ["activation"],
    }
    plan["events"]["$pageview"] = {
        "description": "A page was viewed.",
        "clients": ["web"],
        "answers": ["activation"],
        "builtin": True,
    }
    return plan


class FakePostHog:
    """Answer the PostHog endpoints the sync and audit commands use.

    Lookups return `page_size` hits per page, linked by `next`. A name in `fail` answers its
    PATCH with that status, and `status` answers every request with it.
    """

    def __init__(
        self,
        known: dict[str, str] | None = None,
        seen: list[str] | None = None,
        page_size: int = 100,
        fail: dict[str, int] | None = None,
        status: int | None = None,
    ):
        self.known = known or {}
        self.seen = seen or []
        self.page_size = page_size
        self.fail = fail or {}
        self.status = status
        self.calls: list[tuple[str, str, dict]] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content) if request.content else {}
        self.calls.append((request.method, request.url.raw_path.decode(), body))
        assert request.headers["Authorization"] == "Bearer secret"
        if self.status is not None:
            return httpx2.Response(self.status, json={"detail": "nope"})
        path = request.url.path
        if request.method == "GET" and path == EVENTS_URL:
            return self._lookup(request)
        if request.method == "POST" and path == EVENTS_URL:
            return httpx2.Response(201, json={"id": "new-id", "name": body["name"]})
        if request.method == "PATCH" and path.startswith(EVENTS_URL):
            ident = path.rstrip("/").split("/")[-1]
            name = next((n for n, i in self.known.items() if i == ident), None)
            if name in self.fail:
                return httpx2.Response(self.fail[name], json={"detail": "nope"})
            return httpx2.Response(200, json={"id": ident})
        if request.method == "POST" and path == QUERY_URL:
            return httpx2.Response(
                200, json={"results": [[name] for name in self.seen]}
            )
        return httpx2.Response(404)

    def _lookup(self, request: httpx2.Request) -> httpx2.Response:
        search = request.url.params["search"]
        offset = int(request.url.params.get("offset", "0"))
        hits = [
            {"id": ident, "name": name}
            for name, ident in self.known.items()
            if search in name
        ]
        page = hits[offset : offset + self.page_size]
        more = offset + self.page_size < len(hits)
        next_url = (
            str(request.url.copy_merge_params({"offset": offset + self.page_size}))
            if more
            else None
        )
        return httpx2.Response(200, json={"results": page, "next": next_url})


def client_for(fake: FakePostHog) -> httpx2.Client:
    return httpx2.Client(
        base_url="https://us.posthog.com",
        headers={"Authorization": "Bearer secret"},
        transport=httpx2.MockTransport(fake),
    )


def test_sync_marks_every_plan_event_verified_with_its_description():
    fake = FakePostHog(known={"tune_created": "id-1", "list_created": "id-2"})
    result = sync(sync_plan(), client_for(fake), project_id=PROJECT)

    patches = {path: body for method, path, body in fake.calls if method == "PATCH"}
    assert patches == {
        f"{EVENTS_URL}id-1/": {
            "description": "A tune was added to the catalog.",
            "tags": ["product:app", "apple", "web"],
            "verified": True,
        },
        f"{EVENTS_URL}id-2/": {
            "description": "A list was created.",
            "tags": ["product:site", "site"],
            "verified": True,
        },
    }
    assert result == SyncResult(updated=2, created=0, failed=[])


def test_sync_looks_a_definition_up_by_exact_name():
    fake = FakePostHog(known={"tune_created_twice": "wrong", "tune_created": "id-1"})
    sync(sync_plan(), client_for(fake), project_id=PROJECT)

    lookups = [call for call in fake.calls if call[0] == "GET"]
    assert ("GET", f"{EVENTS_URL}?search=tune_created&limit=100", {}) in lookups
    patched = [path for method, path, _ in fake.calls if method == "PATCH"]
    assert f"{EVENTS_URL}id-1/" in patched
    assert f"{EVENTS_URL}wrong/" not in patched


def test_sync_creates_an_event_posthog_has_not_seen():
    fake = FakePostHog(known={"list_created": "id-2"})
    result = sync(sync_plan(), client_for(fake), project_id=PROJECT)

    posts = [body for method, path, body in fake.calls if method == "POST"]
    assert posts == [{"name": "tune_created"}]
    patched = [path for method, path, _ in fake.calls if method == "PATCH"]
    assert f"{EVENTS_URL}new-id/" in patched
    assert result == SyncResult(updated=1, created=1, failed=[])


def test_sync_follows_lookup_pages_to_the_exact_name():
    known = {f"tune_created_{n}": f"wrong-{n}" for n in range(5)}
    known["tune_created"] = "id-1"
    fake = FakePostHog(known=known, page_size=2)

    sync(sync_plan(), client_for(fake), project_id=PROJECT)

    lookups = [path for method, path, _ in fake.calls if method == "GET"]
    assert len([p for p in lookups if "search=tune_created" in p]) == 3
    patched = [path for method, path, _ in fake.calls if method == "PATCH"]
    assert f"{EVENTS_URL}id-1/" in patched
    posts = [body for method, _, body in fake.calls if method == "POST"]
    assert {"name": "tune_created"} not in posts


def test_sync_reports_each_failure_and_carries_on():
    fake = FakePostHog(
        known={"tune_created": "id-1", "list_created": "id-2"},
        fail={"tune_created": 500},
    )

    result = sync(sync_plan(), client_for(fake), project_id=PROJECT)

    assert result == SyncResult(updated=1, created=0, failed=[("tune_created", 500)])
    patched = [path for method, path, _ in fake.calls if method == "PATCH"]
    assert f"{EVENTS_URL}id-2/" in patched


def test_sync_skips_builtin_events():
    fake = FakePostHog()
    sync(sync_plan(), client_for(fake), project_id=PROJECT)

    assert not any("$pageview" in repr(call) for call in fake.calls)


def test_audit_reports_unplanned_and_unseen_events():
    fake = FakePostHog(seen=["tune_created", "rogue_event", "$pageview"])
    plan = sync_plan()
    plan["events"].pop("$pageview")

    unplanned, unseen = audit(plan, client_for(fake), project_id=PROJECT)

    assert (unplanned, unseen) == (["rogue_event"], ["list_created"])
    method, path, body = fake.calls[0]
    assert (method, path) == ("POST", QUERY_URL)
    assert body == {
        "query": {
            "kind": "HogQLQuery",
            "query": (
                "SELECT DISTINCT event FROM events "
                "WHERE timestamp > now() - INTERVAL 30 DAY LIMIT 10000"
            ),
        }
    }


def test_audit_does_not_expect_builtin_events_to_be_seen():
    fake = FakePostHog(seen=["tune_created", "list_created"])
    assert audit(sync_plan(), client_for(fake), project_id=PROJECT) == ([], [])


def write_plan(tmp_path: Path, plan: dict) -> Path:
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan))
    return path


def test_sync_refuses_to_run_when_check_fails(tmp_path, monkeypatch, capsys):
    bad = copy.deepcopy(BASE)
    bad["events"]["tune_created"]["description"] = ""
    monkeypatch.setattr(
        plan_module, "make_client", lambda env: pytest.fail("reached the network")
    )

    code = main(["sync", "--plan", str(write_plan(tmp_path, bad))])

    assert code == 1
    assert "missing description" in capsys.readouterr().out


def test_audit_refuses_a_plan_whose_events_it_cannot_read(tmp_path, monkeypatch, capsys):
    path = tmp_path / "plan.json"
    path.write_text("{not json")
    monkeypatch.setattr(
        plan_module, "make_client", lambda env: pytest.fail("reached the network")
    )

    code = main(["audit", "--plan", str(path)])

    assert code == 1
    assert "not valid JSON" in capsys.readouterr().out


def test_reports_a_plan_file_that_cannot_be_read(tmp_path):
    problems = check(tmp_path / "missing.json")

    assert len(problems) == 1
    assert problems[0].startswith("the plan could not be read")


def test_audit_exits_one_when_either_list_is_not_empty(tmp_path, monkeypatch, capsys):
    fake = FakePostHog(seen=["tune_created", "rogue_event"])
    monkeypatch.setattr(plan_module, "make_client", lambda env: client_for(fake))
    monkeypatch.setattr(
        plan_module,
        "load_env",
        lambda path=None: {
            "POSTHOG_DEFINITIONS_KEY": "secret",
            "POSTHOG_PROJECT_ID": PROJECT,
        },
    )

    code = main(["audit", "--plan", str(write_plan(tmp_path, BASE))])

    out = capsys.readouterr().out
    assert code == 1
    assert "rogue_event" in out


def test_audit_exits_zero_when_the_plan_and_posthog_agree(tmp_path, monkeypatch):
    fake = FakePostHog(seen=["tune_created"])
    monkeypatch.setattr(plan_module, "make_client", lambda env: client_for(fake))
    monkeypatch.setattr(
        plan_module,
        "load_env",
        lambda path=None: {
            "POSTHOG_DEFINITIONS_KEY": "secret",
            "POSTHOG_PROJECT_ID": PROJECT,
        },
    )

    assert main(["audit", "--plan", str(write_plan(tmp_path, BASE))]) == 0


def test_a_missing_key_or_project_id_exits_two(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(plan_module, "load_env", lambda path=None: {})

    code = main(["audit", "--plan", str(write_plan(tmp_path, BASE))])

    assert code == 2
    assert "POSTHOG_DEFINITIONS_KEY" in capsys.readouterr().err


def test_load_env_reads_the_file_and_real_variables_win(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        '# comment\nPOSTHOG_DEFINITIONS_KEY=from-file\nPOSTHOG_PROJECT_ID="7"\n'
    )
    monkeypatch.setenv("POSTHOG_DEFINITIONS_KEY", "from-env")
    monkeypatch.delenv("POSTHOG_PROJECT_ID", raising=False)

    assert load_env(env_file) == {
        "POSTHOG_DEFINITIONS_KEY": "from-env",
        "POSTHOG_PROJECT_ID": "7",
    }


def use_fake(monkeypatch, fake: FakePostHog) -> None:
    monkeypatch.setattr(plan_module, "make_client", lambda env: client_for(fake))
    monkeypatch.setattr(
        plan_module,
        "load_env",
        lambda path=None: {
            "POSTHOG_DEFINITIONS_KEY": "secret",
            "POSTHOG_PROJECT_ID": PROJECT,
        },
    )


def test_sync_exits_one_with_counts_when_an_event_fails(tmp_path, monkeypatch, capsys):
    plan = sync_plan()
    use_fake(
        monkeypatch,
        FakePostHog(
            known={"tune_created": "id-1", "list_created": "id-2"},
            fail={"tune_created": 500},
        ),
    )

    code = main(["sync", "--plan", str(write_plan(tmp_path, plan))])

    out = capsys.readouterr().out
    assert code == 1
    assert "tune_created: HTTP 500" in out
    assert "updated 1 definitions, created 0, failed 1" in out


@pytest.mark.parametrize("command", ["sync", "audit"])
def test_a_rejected_key_prints_one_line_without_the_key(
    tmp_path, monkeypatch, capsys, command
):
    fake = FakePostHog(status=401)
    use_fake(monkeypatch, fake)

    code = main([command, "--plan", str(write_plan(tmp_path, sync_plan()))])

    captured = capsys.readouterr()
    assert code == 2
    assert len(fake.calls) == 1
    lines = captured.err.strip().splitlines()
    assert len(lines) == 1
    assert "401" in lines[0]
    assert "secret" not in captured.out + captured.err


@pytest.mark.parametrize("command", ["sync", "audit"])
def test_a_network_error_prints_one_line_without_the_key(
    tmp_path, monkeypatch, capsys, command
):
    def unreachable(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused", request=request)

    monkeypatch.setattr(
        plan_module,
        "make_client",
        lambda env: httpx2.Client(
            base_url="https://us.posthog.com",
            headers={"Authorization": "Bearer secret"},
            transport=httpx2.MockTransport(unreachable),
        ),
    )
    monkeypatch.setattr(
        plan_module,
        "load_env",
        lambda path=None: {
            "POSTHOG_DEFINITIONS_KEY": "secret",
            "POSTHOG_PROJECT_ID": PROJECT,
        },
    )

    code = main([command, "--plan", str(write_plan(tmp_path, sync_plan()))])

    captured = capsys.readouterr()
    assert code == 2
    lines = captured.err.strip().splitlines()
    assert len(lines) == 1
    assert "could not reach PostHog" in lines[0]
    assert "secret" not in captured.out + captured.err
