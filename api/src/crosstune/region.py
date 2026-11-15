"""Which privacy rules apply to the caller, so a client knows whether analytics starts off."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from crosstune.geo import request_country
from crosstune.vocabulary import CONSENT_COUNTRIES

router = APIRouter(prefix="/v1/region", tags=["region"])


class RegionResponse(BaseModel):
    """The caller's country and whether consent is required there. Both are null when unknown."""

    country: str | None
    consent_required: bool | None


@router.get("")
async def get_region(request: Request) -> RegionResponse:
    """The caller's country and whether analytics must start off there."""
    country = request_country(request)
    if country is None:
        return RegionResponse(country=None, consent_required=None)
    return RegionResponse(country=country, consent_required=country in CONSENT_COUNTRIES)
