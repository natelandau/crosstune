"""Fan a search out to every requested service, so one slow or broken service costs one group."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import httpx2

from crosstune.links.search.backoff import wait_seconds
from crosstune.links.search.registry import search_url
from crosstune.links.search.types import SearchAuthError
from crosstune.vocabulary import SEARCHABLE_PROVIDERS, Provider, SearchStatus

if TYPE_CHECKING:
    from crosstune.links.search.backoff import Backoff
    from crosstune.links.search.types import Adapter, AdapterAnswer, SearchHit

log = logging.getLogger(__name__)

_RATE_LIMITED = 429


@dataclass
class GroupAnswer:
    """One service's answer: its status, any hits, and its own search page."""

    provider: Provider
    status: SearchStatus
    search_url: str
    results: list[SearchHit] = field(default_factory=list)


async def _run(
    adapter: Adapter,
    provider: Provider,
    query: str,
    country: str,
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- bounds the adapter, not a caller's deadline
    backoff: Backoff,
) -> AdapterAnswer | None:
    if backoff.held(provider):
        return None
    try:
        async with asyncio.timeout(timeout):
            return await adapter(query, country, client, timeout)
    except httpx2.HTTPStatusError as error:
        if error.response.status_code != _RATE_LIMITED:
            log.warning("music search failed", extra={"provider": provider.value}, exc_info=True)
            return None
        seconds = wait_seconds(error.response.headers.get("Retry-After"))
        backoff.hold(provider, seconds)
        log.warning(
            "music search rate limited", extra={"provider": provider.value, "seconds": seconds}
        )
        return None
    except SearchAuthError as error:
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


async def search(
    query: str,
    providers: list[Provider],
    country: str,
    *,
    adapters: dict[Provider, Adapter],
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- bounds each adapter, not a caller's deadline
    backoff: Backoff,
) -> list[GroupAnswer]:
    """Search the requested services at once and return one group per service.

    The group's search page uses the country that answered, which differs from the
    requested one when a catalog fell back. A service with no adapter answers `search_only`. An adapter that raises or exceeds the
    timeout answers `unavailable`. A rejected credential is dropped by the adapter itself.
    A service that answers 429 is held for its Retry-After, and answers `unavailable`
    without being called until then.

    Args:
        query: The search text.
        providers: The requested services, in any order and possibly repeated.
        country: The uppercase two-letter country code.
        adapters: The configured adapters.
        client: The outbound HTTP client.
        timeout: Seconds each adapter may take.
        backoff: The services waiting out a rate limit.

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
                *(_run(adapters[p], p, query, country, client, timeout, backoff) for p in inline)
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
