"""What the API's Sentry error reports may carry.

Reports keep the API's own frame locals for debugging. Everything else that could hold a
user's content, search text, coordinates, or a secret is dropped, scrubbed, or redacted.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, get_args

from pydantic import BaseModel
from sentry_sdk.scrubber import DEFAULT_DENYLIST
from sentry_sdk.utils import iter_event_frames

from crosstune.jobs.media import Probe
from crosstune.logging import redact_driver_values
from crosstune.places.maps import PlaceHit
from crosstune.schemas import rows

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint

IN_APP_PACKAGE = "crosstune"


def _holds_text(annotation: Any) -> bool:
    return annotation is str or any(_holds_text(arg) for arg in get_args(annotation))


def _synced_text_fields() -> set[str]:
    """Every text field of a synced row, so a new text column is scrubbed without a list edit."""
    return {
        name
        for model in vars(rows).values()
        if isinstance(model, type) and issubclass(model, BaseModel)
        for name, field in model.model_fields.items()
        if _holds_text(field.annotation)
    }


# Matched by name at any depth in the API's frame locals and breadcrumb data, ignoring case.
SCRUBBED_KEYS = sorted(
    {
        *DEFAULT_DENYLIST,
        *_synced_text_fields(),
        "email",
        "apple_authorization_code",
        # A Starlette request and the ASGI scope serialize as mappings whose headers carry
        # the bearer token and whose query string carries search text.
        "scope",
        "request",
        "headers",
        "query_string",
        "raw_path",
        "body",
        # A place's name, and any other name, whichever schema it comes from.
        "name",
        # Search text and coordinates.
        "q",
        "query",
        "lat",
        "lon",
        "loc",
        "location",
        "com.apple.quicktime.location.iso6709",
        "place_lat",
        "place_lon",
        "place_accuracy_m",
        # Apple Maps place fields: the point, and the street address reverse geocoding names.
        "coordinate",
        "latitude",
        "longitude",
        "address",
        "structuredaddress",
        "formattedaddresslines",
        "locality",
        # A search result's display lines, and the parts a picked name is built from.
        "displaylines",
        "title",
        "subtitle",
        "town",
        "lines",
        "raw",
        "parts",
        "stored",
        "picked",
        # The account's country, which place search leans toward.
        "country",
        "home",
        # A pushed row's fields, as push validates and writes them.
        "data",
        "values",
        # Outbound request breadcrumbs keep their query here.
        "http.query",
        "http.fragment",
    }
)
# Request and response bodies, synced rows, and settings are all pydantic models, and their
# fields hold user content or secrets; Probe and PlaceHit hold coordinates. A repr would print
# those fields where no key scrubber can reach them.
_REDACTED_TYPES = (BaseModel, Probe, PlaceHit)


def redacted_repr(value: object) -> str | None:
    """Name a redacted object by its type alone, and leave every other value to Sentry."""
    if isinstance(value, _REDACTED_TYPES):
        return f"<{type(value).__name__} redacted>"
    return None


def before_send(event: Event, _hint: Hint) -> Event:
    """Drop the request's query string, library frames' locals, and values a driver quoted.

    Framework and driver frames hold the raw request body and bound statement values under
    names no denylist can predict.
    """
    request = event.get("request")
    if request:
        request.pop("query_string", None)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = url.split("?", 1)[0]
    for frame in iter_event_frames(event):
        if not frame.get("in_app"):
            frame.pop("vars", None)
    for exception in (event.get("exception") or {}).get("values") or []:
        value = exception.get("value")
        if isinstance(value, str):
            exception["value"] = redact_driver_values(value)
    return event
