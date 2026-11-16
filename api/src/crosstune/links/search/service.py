"""Fan a search out to every requested service, so one slow or broken service costs one group."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import httpx2

from crosstune.links.search.budget import OverBudgetError
from crosstune.links.search.registry import search_url
from crosstune.links.search.types import FALLBACK_COUNTRY, RegionNotServedError, SearchAuthError
from crosstune.vocabulary import SEARCHABLE_PROVIDERS, Provider, SearchStatus

if TYPE_CHECKING:
    from collections.abc import Callable

    from crosstune.links.search.backoff import Backoff
    from crosstune.links.search.types import Adapter, AdapterAnswer, SearchHit

log = logging.getLogger(__name__)

# A refused credential is refused for every user, and each retry spends the service's
# rate limit on a request, a token request included, that cannot succeed.
AUTH_HOLD_SECONDS = 60.0


@dataclass
class GroupAnswer:
    """One service's answer: its status, any hits, and its own search page."""

    provider: Provider
    status: SearchStatus
    search_url: str
    results: list[SearchHit] = field(default_factory=list)


async def _with_region_fallback(
    adapter: Adapter,
    provider: Provider,
    query: str,
    country: str,
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- forwarded to the adapter's per-request timeout
    charge_fallback: Callable[[], bool],
) -> AdapterAnswer | None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    try:
        return await adapter(query, country, client, timeout)
    except RegionNotServedError:
        if not charge_fallback():
            log.info(
                "music search region fallback over the caller's limit",
                extra={"provider": provider.value},
            )
            return None
    # Only what is left of the timeout, so a deadline the adapter derives from it, such
    # as TIDAL's artist lookup, still ends inside the caller's timeout.
    return await adapter(query, FALLBACK_COUNTRY, client, max(deadline - loop.time(), 0.0))


async def _run(  # noqa: PLR0913 -- every option after the country is keyword-only
    adapter: Adapter,
    provider: Provider,
    query: str,
    country: str,
    *,
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- bounds the adapter, not a caller's deadline
    backoff: Backoff,
    charge_fallback: Callable[[], bool],
) -> AdapterAnswer | None:
    if backoff.held(provider):
        return None
    try:
        async with asyncio.timeout(timeout):
            return await _with_region_fallback(
                adapter, provider, query, country, client, timeout, charge_fallback
            )
    except httpx2.HTTPStatusError as error:
        seconds = backoff.hold_if_limited(provider, error)
        if seconds is None:
            log.warning("music search failed", extra={"provider": provider.value}, exc_info=True)
        else:
            log.warning(
                "music search rate limited", extra={"provider": provider.value, "seconds": seconds}
            )
        return None
    except OverBudgetError:
        # The service was not called, so this is the budget working, not a failure.
        log.info("music search over budget", extra={"provider": provider.value})
        return None
    except SearchAuthError as error:
        backoff.hold(provider, AUTH_HOLD_SECONDS)
        # ERROR because no user retry can fix the API's own credentials. No exc_info: the
        # chained request's frames hold the bearer token, and Sentry records frame locals.
        log.error(  # noqa: TRY400
            "music search credentials refused",
            extra={"provider": provider.value, "reason": str(error)},
        )
        return None
    except Exception:
        log.warning("music search failed", extra={"provider": provider.value}, exc_info=True)
        return None


async def search(  # noqa: PLR0913 -- every option after the country is keyword-only
    query: str,
    providers: list[Provider],
    country: str,
    *,
    adapters: dict[Provider, Adapter],
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- bounds each adapter, not a caller's deadline
    backoff: Backoff,
    charge_fallback: Callable[[], bool],
) -> list[GroupAnswer]:
    """Search the requested services at once and return one group per service.

    A catalog that does not serve the requested country is searched again for the US,
    once `charge_fallback` has counted that request against the caller's limit; with no
    room left there, it answers `unavailable`. The group's search page uses the country
    that answered. A service with no adapter answers `search_only`. An adapter that
    raises or exceeds the timeout answers `unavailable`. A rejected credential is dropped
    by the adapter itself. A service that answers 429 is held for its Retry-After, and
    one that refuses the credentials is held for a minute; either answers `unavailable`
    without being called until then. A service whose outbound budget is spent also
    answers `unavailable` without being called.

    Args:
        query: The search text.
        providers: The requested services, in any order and possibly repeated.
        country: The uppercase two-letter country code.
        adapters: The configured adapters.
        client: The outbound HTTP client.
        timeout: Seconds each adapter may take.
        backoff: The services waiting out a rate limit.
        charge_fallback: Counts one more outbound request against the caller's limit,
            returning False when the limit has no room for it.

    Returns:
        list[GroupAnswer]: One group per distinct requested service, in the fixed group order.
    """
    requested = set(providers)
    wanted = [p for p in SEARCHABLE_PROVIDERS if p in requested]
    inline = [p for p in wanted if p in adapters]
    answers = dict(
        zip(
            inline,
            await asyncio.gather(
                *(
                    _run(
                        adapters[p],
                        p,
                        query,
                        country,
                        client=client,
                        timeout=timeout,
                        backoff=backoff,
                        charge_fallback=charge_fallback,
                    )
                    for p in inline
                )
            ),
            strict=True,
        )
    )
    groups: list[GroupAnswer] = []
    for provider in wanted:
        if provider not in answers:
            groups.append(
                GroupAnswer(
                    provider, SearchStatus.SEARCH_ONLY, search_url(provider, query, country)
                )
            )
        elif (result := answers[provider]) is None:
            groups.append(
                GroupAnswer(
                    provider, SearchStatus.UNAVAILABLE, search_url(provider, query, country)
                )
            )
        else:
            url = search_url(provider, query, result.country)
            groups.append(GroupAnswer(provider, SearchStatus.RESULTS, url, result.hits))
    return groups
