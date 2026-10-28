"""In-memory fakes for hosted services."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from crosstune.email.resend import MailerRateLimitedError
from crosstune.storage.store import ListedObject, ObjectInfo
from crosstune.users.clerk import ClerkUser

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import timedelta
    from pathlib import Path

    from crosstune.billing.grants import PaidSubscription
    from crosstune.email.resend import EmailMessage
    from crosstune.users.apple import AppleClient


class FakeClerkUsers:
    """A fake ClerkUsers.

    While `error` is set, every call raises it; `apple_error` fails only `apple_user_ids`.
    `users` maps each Clerk user ID that `find_user` knows to its email, or None.
    `apple_ids` maps a Clerk user ID to its Apple user IDs.
    """

    def __init__(
        self,
        users: dict[str, str | None] | None = None,
        *,
        apple_ids: dict[str, frozenset[str]] | None = None,
    ) -> None:
        self.deleted: list[str] = []
        self.error: Exception | None = None
        self.apple_error: Exception | None = None
        self.apple_ids: dict[str, frozenset[str]] = apple_ids if apple_ids is not None else {}
        self.users: dict[str, str | None] = users if users is not None else {}
        self.looked_up: list[str] = []

    async def delete_user(self, clerk_user_id: str) -> None:
        """Record the id, or raise the configured error instead of deleting."""
        if self.error is not None:
            raise self.error
        self.deleted.append(clerk_user_id)

    async def find_user(self, account: str) -> ClerkUser | None:
        """The configured user for a Clerk user ID, or raise the configured error instead."""
        self.looked_up.append(account)
        if self.error is not None:
            raise self.error
        if account not in self.users:
            return None
        return ClerkUser(account, self.users[account])

    async def apple_user_ids(self, clerk_user_id: str) -> frozenset[str]:
        """The configured Apple IDs, or raise `apple_error`, else `error`, instead."""
        if self.apple_error is not None:
            raise self.apple_error
        if self.error is not None:
            raise self.error
        return self.apple_ids.get(clerk_user_id, frozenset())


class FakeAppleSignIn:
    """A fake AppleSignIn. While `error` is set, `revoke` records the call, then raises it."""

    def __init__(self, events: list[str] | None = None) -> None:
        self.calls: list[tuple[str, frozenset[str], AppleClient]] = []
        self.error: Exception | None = None
        self.events = events

    async def revoke(
        self, code: str, apple_user_ids: frozenset[str], *, client: AppleClient
    ) -> None:
        """Record the call, or raise the configured error after recording it."""
        self.calls.append((code, apple_user_ids, client))
        if self.events is not None:
            self.events.append("apple")
        if self.error is not None:
            raise self.error


class FakeMailer:
    """A fake Mailer. While `error` is set, every send and batch raises it.

    `sent_batches` records each accepted batch. When `rate_limit_after_batches` is set,
    the batch after that many accepted ones raises `MailerRateLimitedError`.
    """

    def __init__(self) -> None:
        self.sent: list[tuple[EmailMessage, str]] = []
        self.sent_batches: list[tuple[list[EmailMessage], str]] = []
        self.error: Exception | None = None
        self.rate_limit_after_batches: int | None = None

    async def send(self, message: EmailMessage, *, idempotency_key: str) -> None:
        """Record the message and its key, or raise the configured error instead."""
        if self.error is not None:
            raise self.error
        self.sent.append((message, idempotency_key))

    async def send_batch(self, messages: list[EmailMessage], *, idempotency_key: str) -> None:
        """Record the batch and its key, or raise the configured error instead."""
        if self.error is not None:
            raise self.error
        if (
            self.rate_limit_after_batches is not None
            and len(self.sent_batches) >= self.rate_limit_after_batches
        ):
            msg = "Resend answered 429 on /emails/batch"
            raise MailerRateLimitedError(msg)
        self.sent_batches.append((list(messages), idempotency_key))


class FakeRevenueCat:
    """A fake RevenueCat. While `error` is set, every call raises it."""

    def __init__(
        self,
        subscriptions_by_customer: dict[str, list[PaidSubscription]] | None = None,
        error: Exception | None = None,
        deleted: list[str] | None = None,
    ) -> None:
        self.subscriptions_by_customer = subscriptions_by_customer or {}
        self.error = error
        self.deleted = deleted if deleted is not None else []

    async def subscriptions(
        self, customer_id: str, *, now: datetime | None = None
    ) -> list[PaidSubscription]:
        """The customer's configured subscriptions, or raise the configured error."""
        if self.error is not None:
            raise self.error
        return list(self.subscriptions_by_customer.get(customer_id, []))

    async def delete_customer(self, customer_id: str) -> None:
        """Record the id, or raise the configured error instead of deleting."""
        if self.error is not None:
            raise self.error
        self.deleted.append(customer_id)


class FakeStripe:
    """A fake StripeSubscriptions.

    While `error` is set, every call raises it, or only the method named by `fail_only`.
    `calls` logs each call that did not raise, in order.
    """

    def __init__(
        self,
        cancelled: list[str] | None = None,
        error: Exception | None = None,
        fail_only: str | None = None,
    ) -> None:
        self.cancelled = cancelled if cancelled is not None else []
        self.error = error
        self.fail_only = fail_only
        self.payment_intent = "pi_fake"
        self.refunds: list[tuple[str, str]] = []
        self.calls: list[str] = []

    def _check(self, method: str) -> None:
        if self.error is not None and self.fail_only in (None, method):
            raise self.error
        self.calls.append(method)

    async def cancel(self, store_id: str) -> None:
        """Record the id, or raise the configured error instead of cancelling."""
        self._check("cancel")
        self.cancelled.append(store_id)

    async def first_payment_intent(self, store_id: str) -> str:
        """The configured intent, or raise the configured error."""
        self._check("first_payment_intent")
        return self.payment_intent

    async def refund(self, payment_intent: str, *, idempotency_key: str) -> None:
        """Record the intent and key, or raise the configured error instead of refunding."""
        self._check("refund")
        self.refunds.append((payment_intent, idempotency_key))


class FakeAnalyticsPersons:
    """A fake AnalyticsPersons. While `error` is set, every delete_person raises it."""

    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.error: Exception | None = None

    async def delete_person(self, distinct_id: str) -> None:
        """Record the id, or raise the configured error instead of deleting."""
        if self.error is not None:
            raise self.error
        self.deleted.append(distinct_id)


class FakeObjectStore:
    """An ObjectStore held in a dict. Presigned URLs are recognizable strings, not signatures."""

    def __init__(self) -> None:
        self._objects: dict[str, tuple[bytes, str]] = {}
        self._modified: dict[str, datetime] = {}
        self.presigned: list[tuple[str, str]] = []
        self.deleted_prefixes: list[str] = []
        # Every key `upload` wrote, kept after a delete, so a test can see a write that was undone.
        self.uploaded: list[str] = []

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        """What a client's PUT to a presigned URL leaves behind."""
        self._objects[key] = (data, content_type)
        self._modified[key] = datetime.now(UTC)

    def age(self, key: str, by: timedelta) -> None:
        """Move an object's last write time back, as if it were written `by` ago."""
        self._modified[key] -= by

    def get_bytes(self, key: str) -> bytes:
        """The stored bytes of one object."""
        return self._objects[key][0]

    def keys(self) -> list[str]:
        """Every stored key, sorted."""
        return sorted(self._objects)

    def presign_put(self, key: str, content_type: str, content_length: int, expires_in: int) -> str:
        """A URL a client can PUT one object to, with the type and length in the signature."""
        self.presigned.append(("put", key))
        return (
            f"https://fake.r2/{key}?put&content_type={content_type}"
            f"&content_length={content_length}&expires={expires_in}"
        )

    def presign_get(self, key: str, expires_in: int) -> str:
        """A URL a client can GET one object from."""
        self.presigned.append(("get", key))
        return f"https://fake.r2/{key}?get&expires={expires_in}"

    async def head(self, key: str) -> ObjectInfo | None:
        """Size and type of an object, or None when it does not exist."""
        stored = self._objects.get(key)
        if stored is None:
            return None
        return ObjectInfo(size=len(stored[0]), content_type=stored[1])

    async def download(self, key: str, path: Path) -> None:
        """Fetch an object into a local file."""
        path.write_bytes(self._objects[key][0])  # noqa: ASYNC240 -- in-memory fake, no real I/O

    async def upload(self, path: Path, key: str, content_type: str) -> int:
        """Store a local file. Returns the byte count stored."""
        data = path.read_bytes()  # noqa: ASYNC240 -- in-memory fake, no real I/O
        self._objects[key] = (data, content_type)
        self._modified[key] = datetime.now(UTC)
        self.uploaded.append(key)
        return len(data)

    async def copy(self, source: str, target: str) -> None:
        """Copy an object within the bucket."""
        self._objects[target] = self._objects[source]
        self._modified[target] = datetime.now(UTC)

    async def delete(self, *keys: str) -> None:
        """Remove objects. Missing keys are not an error."""
        for key in keys:
            self._objects.pop(key, None)

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""
        self.deleted_prefixes.append(prefix)
        for key in [k for k in self._objects if k.startswith(prefix)]:
            del self._objects[key]

    async def list_objects(self, prefix: str = "") -> list[ListedObject]:
        """Every object under `prefix`, or in the bucket, with its last write time."""
        return [
            ListedObject(key=key, modified=self._modified[key])
            for key in sorted(key for key in self._objects if key.startswith(prefix))
        ]


class FakeRunner:
    """Counts wakes in place of a job runner, optionally checking state at each one."""

    def __init__(self, on_wake: Callable[[], None] | None = None) -> None:
        self.wakes = 0
        self._on_wake = on_wake

    def wake(self) -> None:
        self.wakes += 1
        if self._on_wake is not None:
            self._on_wake()
