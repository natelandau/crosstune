"""Put the shared development accounts in the billing states their names promise.

Run as `just api::testdata-accounts`. Each account is `<state>+clerk_test@<domain>`, with the
domain from `CROSSTUNE_TESTDATA_EMAIL_DOMAIN`. An account that exists keeps its data: only its
billing state is set, which also shows its one-time notices again. An account missing from
Clerk is created there, and an account missing from this database is seeded from scratch.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import ValidationError
from sqlalchemy import select

from crosstune.models import User
from crosstune.ops.billing import load_settings, settings_error
from crosstune.ops.testdata import cli
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.ops.testdata.state import AccountState
from crosstune.users.clerk import ClerkUnavailableError

if TYPE_CHECKING:
    from crosstune.config import Settings
    from crosstune.users.clerk import ClerkUser


@dataclass(frozen=True)
class DevAccount:
    """One shared development account and the billing state it is kept in."""

    email: str
    state: AccountState


def dev_accounts(settings: Settings) -> list[DevAccount]:
    """Name the development accounts, one per billing state.

    Returns:
        list[DevAccount]: The accounts in the order the command works on them.

    Raises:
        DataCommandError: `CROSSTUNE_TESTDATA_EMAIL_DOMAIN` is unset.
    """
    domain = settings.testdata_email_domain.strip()
    if not domain:
        msg = "CROSSTUNE_TESTDATA_EMAIL_DOMAIN is unset; set it in api/.env"
        raise DataCommandError(msg)
    return [DevAccount(f"{state.value}+clerk_test@{domain}", state) for state in AccountState]


async def _find_or_create(connections: cli.Connections, email: str) -> tuple[ClerkUser, bool]:
    """Find the Clerk user, creating it when missing.

    Returns:
        tuple: The user, and whether the account has no local row and so needs a seed.
    """
    found = await connections.clerk.find_user(email)
    if found is None:
        try:
            found = await connections.clerk.create_user(email)
        except ClerkUnavailableError:
            # Another run, such as a worktree made at the same time, may have just created it.
            found = await connections.clerk.find_user(email)
            if found is None:
                raise
        else:
            print(f"created Clerk user {found.id} <{email}>")
            return found, True
    async with connections.sessionmaker() as session:
        existing = await session.scalar(select(User.id).where(User.clerk_user_id == found.id))
    return found, existing is None


async def run(settings: Settings) -> list[str]:
    """Bring every development account to its state, going on past one that fails.

    Returns:
        list[str]: One line per account that failed, empty when all succeeded.
    """
    cli.check_target(settings)
    accounts = dev_accounts(settings)
    # Checked before Clerk is touched, so a broken fixture never creates a user.
    seed_args = cli.parse_args([accounts[0].email])
    fixture = cli.checked_fixture(seed_args)
    failures: list[str] = []
    async with cli.open_connections(settings) as connections:
        for account in accounts:
            print(f"\n{account.email}: {account.state.value}")
            try:
                found, seed = await _find_or_create(connections, account.email)
                argv = [account.email, "--state", account.state.value]
                if not seed:
                    argv.append("--state-only")
                await cli.run_account(
                    connections, found, settings, cli.parse_args(argv), fixture if seed else None
                )
            except cli.COMMAND_ERRORS as exc:
                failures.append(f"{account.email}: {cli.describe_error(exc)}")
    return failures


def main() -> int:
    """Run the command, and exit 1 when any account failed."""
    try:
        failures = asyncio.run(run(load_settings()))
    except ValidationError as exc:
        print(settings_error(exc), file=sys.stderr)
        return 1
    except cli.COMMAND_ERRORS as exc:
        print(cli.describe_error(exc), file=sys.stderr)
        return 1
    if failures:
        print("\n" + "\n".join(failures), file=sys.stderr)
        return 1
    print("\nSign out of these accounts on every device to see their notices again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
