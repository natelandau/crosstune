"""The comp and trial operator commands."""

from __future__ import annotations

import getpass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import anyio.to_thread
import pytest
from sqlalchemy import select, text

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import grant_comp, set_trial_end
from crosstune.config import Settings
from crosstune.db.locks import advisory_lock_key
from crosstune.models import Entitlement, Grant, PendingComp
from crosstune.models.user import utc_now
from crosstune.ops import billing
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import GrantSource

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import User

pytestmark = pytest.mark.anyio

NOW = datetime(2030, 1, 1, tzinfo=UTC)
PREMIUM = 5_368_709_120
ADDON = 53_687_091_200
FREE_USER = "user_billing_ops"
EMAIL = "Person@Example.com"


async def _run(session: AsyncSession, settings: Settings, *argv: str) -> str:
    args = billing.build_parser().parse_args(argv)
    args.by = getattr(args, "by", None) or "tester"
    command = billing.comp if args.command == "comp" else billing.trial
    return await command(session, settings, args)


async def _user(session: AsyncSession, settings: Settings) -> User:
    return await get_or_create_user(session, FREE_USER, EMAIL, settings)


async def _entitlement(session: AsyncSession, user: User) -> Entitlement:
    return (
        await session.execute(
            select(Entitlement)
            .where(Entitlement.user_id == user.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def test_comp_by_clerk_id_makes_the_account_comped(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "comp", FREE_USER, "--reason", "friend")
    row = await _entitlement(session, user)
    assert row.premium_source == "comp"
    assert row.premium_expires_at is None
    assert row.premium_quota_bytes == PREMIUM


async def test_comp_by_email_ignores_case(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "comp", EMAIL.upper(), "--reason", "friend")
    assert (await _entitlement(session, user)).premium_source == "comp"


async def test_comp_by_unknown_email_saves_a_lowercased_pending_comp(
    session: AsyncSession, settings: Settings
) -> None:
    message = await _run(session, settings, "comp", "New@Example.com", "--reason", "press")
    pending = (await session.scalars(select(PendingComp))).all()
    assert [p.email for p in pending] == ["new@example.com"]
    assert pending[0].reason == "press"
    assert "no account has the email new@example.com" in message
    assert "Clerk user ID" in message

    await _run(session, settings, "comp", "NEW@example.com", "--reason", "again", "--addon")
    session.expire_all()
    pending = (await session.scalars(select(PendingComp))).all()
    assert [(p.reason, p.storage_addon) for p in pending] == [("again", True)]


async def test_revoke_deletes_a_pending_comp(session: AsyncSession, settings: Settings) -> None:
    await _run(session, settings, "comp", "new@example.com", "--reason", "press")
    await _run(session, settings, "comp", "new@example.com", "--revoke")
    assert (await session.scalars(select(PendingComp))).all() == []


async def test_revoke_ends_the_comp(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "comp", FREE_USER, "--reason", "friend")
    await _run(session, settings, "comp", FREE_USER, "--revoke")
    row = await _entitlement(session, user)
    assert row.premium_source != "comp"


async def test_addon_adds_storage(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "comp", FREE_USER, "--addon", "--reason", "big library")
    assert (await _entitlement(session, user)).premium_quota_bytes == PREMIUM + ADDON


async def test_until_ends_the_comp_on_that_date(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "comp", FREE_USER, "--until", "2999-01-02", "--reason", "x")
    row = await _entitlement(session, user)
    assert row.premium_expires_at is not None
    assert row.premium_expires_at.year == 2999


async def _trial(session: AsyncSession, user: User) -> Grant:
    return (
        await session.execute(
            select(Grant)
            .where(Grant.user_id == user.id, Grant.source == GrantSource.TRIAL.value)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def test_comp_ends_a_running_trial_even_when_it_ends_sooner(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    before = utc_now()
    await _run(session, settings, "comp", FREE_USER, "--until", "3d", "--reason", "x")
    assert (await _trial(session, user)).expires_at <= utc_now()
    assert (await _trial(session, user)).expires_at >= before
    row = await _entitlement(session, user)
    assert row.premium_source == "comp"
    assert row.premium_quota_bytes == PREMIUM


async def test_grant_comp_ends_the_trial_at_now(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await session.commit()
    now = utc_now()
    await grant_comp(
        session,
        user.id,
        expires_at=now + timedelta(days=3),
        storage_addon=False,
        granted_by="t",
        reason="r",
        now=now,
    )
    await refresh_entitlement(session, user.id, settings, now)
    assert (await _trial(session, user)).expires_at == now
    row = await _entitlement(session, user)
    assert row.premium_source == "comp"
    assert row.premium_quota_bytes == PREMIUM


async def test_grant_comp_leaves_an_expired_trial_unchanged(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    now = utc_now()
    ended = now - timedelta(days=2)
    await set_trial_end(session, user.id, ended)
    await grant_comp(
        session,
        user.id,
        expires_at=None,
        storage_addon=False,
        granted_by="t",
        reason="r",
        now=now,
    )
    assert (await _trial(session, user)).expires_at == ended


async def test_trial_ends_moves_the_trial(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    before = utc_now()
    await _run(session, settings, "trial", FREE_USER, "--ends", "2d")
    row = await _entitlement(session, user)
    assert row.trial_ends_at is not None
    assert timedelta(days=1, hours=23) < row.trial_ends_at - before < timedelta(days=2, minutes=5)


async def test_trial_ends_is_refused_while_a_comp_holds_premium(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "comp", FREE_USER, "--until", "10d", "--reason", "r")

    with pytest.raises(billing.BillingCommandError):
        await _run(session, settings, "trial", FREE_USER, "--ends", "30d")
    assert (await _entitlement(session, user)).premium_source == GrantSource.COMP


async def test_trial_ended_makes_the_account_free(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "trial", FREE_USER, "--ended")
    assert (await _entitlement(session, user)).premium_source is None


async def test_unknown_account_is_an_error(session: AsyncSession, settings: Settings) -> None:
    with pytest.raises(billing.BillingCommandError):
        await _run(session, settings, "trial", "user_missing", "--ended")
    with pytest.raises(billing.BillingCommandError):
        await _run(session, settings, "comp", "user_missing", "--reason", "x")


async def test_an_email_matching_two_accounts_lists_their_ids(
    session: AsyncSession, settings: Settings
) -> None:
    await get_or_create_user(session, "user_a", "dup@example.com", settings)
    await get_or_create_user(session, "user_b", "DUP@example.com", settings)
    with pytest.raises(billing.BillingCommandError, match="user_a, user_b"):
        await _run(session, settings, "trial", "dup@example.com", "--ended")


def test_production_needs_yes(capsys: pytest.CaptureFixture[str]) -> None:
    settings = Settings.model_construct(
        environment="production", database_url="postgresql+asyncpg://u@db.example/crosstune"
    )
    with pytest.raises(billing.BillingCommandError, match="--yes"):
        billing.check_target(settings, yes=False)
    billing.check_target(settings, yes=True)
    assert "db.example" in capsys.readouterr().out


def test_main_refuses_production_without_yes(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    production = Settings.model_construct(
        environment="production", database_url="postgresql+asyncpg://u@db.example/crosstune"
    )
    monkeypatch.setattr(billing, "load_settings", lambda: production)
    assert billing.main(["trial", "user_x", "--ended"]) == 1
    assert "--yes" in capsys.readouterr().err


def _host_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, **env: str) -> None:
    """Run from a directory whose .env holds a local-only key, with the env file read again."""
    (tmp_path / ".env").write_text(
        "CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL=http://localhost:9000\n", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setitem(Settings.model_config, "env_file", ".env")
    for name in (
        "LOCAL_STORAGE_ENDPOINT_URL",
        "CLERK_ISSUER",
        "CLERK_SECRET_KEY",
        "CLERK_AUTHORIZED_PARTIES",
    ):
        monkeypatch.delenv(f"CROSSTUNE_{name}", raising=False)
    for name, value in env.items():
        monkeypatch.setenv(f"CROSSTUNE_{name}", value)


def test_a_hosted_environment_ignores_the_local_env_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _host_environment(monkeypatch, tmp_path, ENVIRONMENT="development")
    assert billing.load_settings().local_storage_endpoint_url == "http://localhost:9000"

    _host_environment(
        monkeypatch,
        tmp_path,
        ENVIRONMENT="production",
        CLERK_ISSUER="https://clerk.example.com",
        CLERK_SECRET_KEY="sk_live_x",
        CLERK_AUTHORIZED_PARTIES='["https://my.example.com"]',
    )
    assert billing.load_settings().local_storage_endpoint_url == ""


def test_unusable_settings_print_one_line_and_fail(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _host_environment(monkeypatch, tmp_path, ENVIRONMENT="production")
    assert billing.main(["trial", "user_x", "--ended"]) == 1
    err = capsys.readouterr().err
    assert err.count("\n") == 1
    assert "CROSSTUNE_CLERK_ISSUER" in err


def test_the_e2e_database_is_refused() -> None:
    e2e = Settings.model_construct(
        environment="development", database_url="postgresql+asyncpg://u@localhost/crosstune_e2e"
    )
    with pytest.raises(billing.BillingCommandError, match="e2e"):
        billing.check_target(e2e, yes=True)


def test_comp_needs_a_reason_unless_revoking() -> None:
    with pytest.raises(SystemExit):
        billing.main(["comp", "user_x"])


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("3h", NOW + timedelta(hours=3)),
        ("15m", NOW + timedelta(minutes=15)),
        ("2D", NOW + timedelta(days=2)),
        ("2030-05-06T07:08:09+02:00", datetime(2030, 5, 6, 5, 8, 9, tzinfo=UTC)),
        ("2030-05-06T07:08:09", datetime(2030, 5, 6, 7, 8, 9, tzinfo=UTC)),
        ("2030-05-06", datetime(2030, 5, 6, tzinfo=UTC)),
    ],
)
def test_parse_when(text: str, expected: datetime) -> None:
    assert billing.parse_when(text, NOW) == expected


async def test_an_email_that_starts_with_user_is_an_email(
    session: AsyncSession, settings: Settings
) -> None:
    user = await get_or_create_user(session, "user_other", "user_1@example.com", settings)
    await _run(session, settings, "comp", "user_1@example.com", "--reason", "x")
    assert (await _entitlement(session, user)).premium_source == "comp"


@pytest.fixture
def committed_settings(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> Settings:
    monkeypatch.setattr(billing, "load_settings", lambda: settings)
    return settings


async def test_main_comp_commits_and_records_the_login(
    committed_settings: Settings, verify_session: AsyncSession
) -> None:
    user = await get_or_create_user(
        verify_session, "user_main", "m@example.com", committed_settings
    )
    await verify_session.commit()

    code = await anyio.to_thread.run_sync(
        billing.main, ["comp", "user_main", "--addon", "--reason", "r"]
    )

    assert code == 0
    grants = (await verify_session.scalars(select(Grant).where(Grant.source == "comp"))).all()
    assert {g.kind for g in grants} == {"premium", "storage_addon"}
    assert {g.granted_by for g in grants} == {getpass.getuser()}
    row = await _entitlement(verify_session, user)
    assert (row.premium_source, row.premium_quota_bytes) == ("comp", PREMIUM + ADDON)


async def test_main_trial_commits(
    committed_settings: Settings, verify_session: AsyncSession
) -> None:
    user = await get_or_create_user(
        verify_session, "user_main", "m@example.com", committed_settings
    )
    await verify_session.commit()
    before = utc_now()

    code = await anyio.to_thread.run_sync(billing.main, ["trial", "user_main", "--ends", "2d"])

    assert code == 0
    row = await _entitlement(verify_session, user)
    assert row.trial_ends_at is not None
    assert timedelta(days=1, hours=23) < row.trial_ends_at - before < timedelta(days=2, minutes=5)


@pytest.mark.parametrize("bad", ["soon", "2d3h", "2026-13-40"])
def test_parse_when_rejects_nonsense(bad: str) -> None:
    with pytest.raises(billing.BillingCommandError):
        billing.parse_when(bad, utc_now())


async def _holds_user_lock(session: AsyncSession, user: User) -> bool:
    key = advisory_lock_key(user.id) & 0xFFFFFFFFFFFFFFFF
    held = await session.scalar(
        text(
            "select count(*) from pg_locks where locktype = 'advisory'"
            " and pid = pg_backend_pid() and mode = 'ExclusiveLock' and objsubid = 1"
            " and classid::bigint = :high and objid::bigint = :low"
        ),
        {"high": key >> 32, "low": key & 0xFFFFFFFF},
    )
    return held == 1


@pytest.mark.parametrize(
    "argv",
    [
        ("comp", FREE_USER, "--reason", "friend"),
        ("comp", FREE_USER, "--revoke"),
        ("trial", FREE_USER, "--ends", "2d"),
    ],
)
async def test_commands_lock_the_user(
    session: AsyncSession, settings: Settings, argv: tuple[str, ...]
) -> None:
    user = await _user(session, settings)
    assert not await _holds_user_lock(session, user)
    await _run(session, settings, *argv)
    assert await _holds_user_lock(session, user)


async def test_comp_until_in_the_past_is_refused(session: AsyncSession, settings: Settings) -> None:
    await _user(session, settings)
    with pytest.raises(billing.BillingCommandError, match="past"):
        await _run(session, settings, "comp", FREE_USER, "--until", "2001-01-01", "--reason", "x")
    with pytest.raises(billing.BillingCommandError, match="past"):
        await _run(
            session, settings, "comp", "new@example.com", "--until", "2001-01-01", "--reason", "x"
        )
    assert (await session.scalars(select(Grant).where(Grant.source == "comp"))).all() == []
    assert (await session.scalars(select(PendingComp))).all() == []


async def test_trial_ends_in_the_past_is_allowed(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await _run(session, settings, "trial", FREE_USER, "--ends", "2001-01-01")
    row = await _entitlement(session, user)
    assert row.premium_source is None
    assert row.trial_ends_at == datetime(2001, 1, 1, tzinfo=UTC)


@pytest.mark.parametrize("extra", [("--until", "2d"), ("--addon",)])
def test_revoke_refuses_until_and_addon(extra: tuple[str, ...]) -> None:
    with pytest.raises(SystemExit):
        billing.main(["comp", "user_x", "--revoke", *extra])


async def test_re_comp_updates_the_end_and_the_audit_fields(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    await _run(
        session,
        settings,
        "comp",
        FREE_USER,
        "--until",
        "2999-01-02",
        "--reason",
        "first",
        "--by",
        "a",
    )
    await _run(
        session,
        settings,
        "comp",
        FREE_USER,
        "--until",
        "2999-03-04",
        "--reason",
        "second",
        "--by",
        "b",
    )
    grant = (
        await session.execute(
            select(Grant)
            .where(Grant.user_id == user.id, Grant.source == "comp")
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert grant.expires_at == datetime(2999, 3, 4, tzinfo=UTC)
    assert (grant.reason, grant.granted_by) == ("second", "b")
    assert (await _entitlement(session, user)).premium_expires_at == grant.expires_at
