"""slippery_hill provider, re-detected links, and the service in every search setting

Revision ID: 0023
Revises: 0022
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

OLD_PROVIDERS = (
    "youtube",
    "spotify",
    "apple_music",
    "bandcamp",
    "soundcloud",
    "tidal",
    "internet_archive",
    "other",
)
NEW_PROVIDERS = (*OLD_PROVIDERS[:-1], "slippery_hill", "other")

OLD_SERVICES = (
    "apple_music",
    "tidal",
    "internet_archive",
    "youtube",
    "spotify",
    "bandcamp",
    "soundcloud",
)
NEW_SERVICES = (*OLD_SERVICES[:3], "slippery_hill", *OLD_SERVICES[3:])

# A frozen copy of the matching rules at this revision, so later changes to
# crosstune.links.detect never change what this migration does.
ORIGIN = "https://www.slippery-hill.com"
FILES = "/system/files/"
FILE_REF = re.compile(r"(?:[A-Za-z0-9_~%()!*'+,.-]+/)*[A-Za-z0-9_~%()!*'+,.-]+(?i:\.mp3)")
PAGE = re.compile(r"/content/([A-Za-z0-9-]+)/?")
MAX_REF = 200
TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "si",
    "feature",
}


def _valid_ref(ref: str) -> bool:
    return (
        len(ref) <= MAX_REF
        and FILE_REF.fullmatch(ref) is not None
        and "%2e" not in ref.lower()
        and not {".", ".."} & set(ref.split("/"))
    )


def redetect(url: str) -> tuple[str, str | None, str] | None:
    """Identify a Slippery-Hill URL that was saved as a plain link.

    Args:
        url: The stored URL of a link whose provider is `other`.

    Returns:
        tuple[str, str | None, str] | None: The provider, provider ref, and canonical URL,
            or None when the URL is not on Slippery-Hill.
    """
    try:
        parts = urlparse(url)
    except ValueError:
        return None
    host = (parts.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if host != "slippery-hill.com":
        return None
    if parts.path.startswith(FILES):
        ref = parts.path[len(FILES) :]
        if _valid_ref(ref):
            return "slippery_hill", ref, f"{ORIGIN}{FILES}{ref}"
    elif page := PAGE.fullmatch(parts.path):
        return "slippery_hill", None, f"{ORIGIN}/content/{page.group(1)}"
    kept = [
        (k, v[0])
        for k, v in parse_qs(parts.query, keep_blank_values=True).items()
        if k not in TRACKING_PARAMS
    ]
    stripped = urlunparse(parts._replace(query=urlencode(kept), fragment=""))
    return "slippery_hill", None, stripped


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def _replace_provider_constraint(providers: tuple[str, ...]) -> None:
    op.drop_constraint("ck_recording_links_provider", "recording_links", type_="check")
    op.create_check_constraint(
        "ck_recording_links_provider",
        "recording_links",
        f"provider in ({_quoted(providers)})",
    )


def _set_search_default(services: tuple[str, ...]) -> None:
    op.alter_column(
        "user_settings",
        "search_providers",
        server_default="{" + ",".join(services) + "}",
    )


def upgrade() -> None:
    _replace_provider_constraint(NEW_PROVIDERS)
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("select id, url from recording_links where provider = 'other'")
    ).all()
    for link_id, url in rows:
        found = redetect(url)
        if found is None:
            continue
        provider, ref, canonical = found
        # A fresh server_seq is what makes clients pull the corrected row.
        conn.execute(
            sa.text(
                "update recording_links set provider = :provider, provider_ref = :ref, "
                "url = :url, updated_at = now(), server_seq = nextval('sync_seq') "
                "where id = :id"
            ),
            {"provider": provider, "ref": ref, "url": canonical, "id": link_id},
        )
    settings = conn.execute(
        sa.text(
            "select id, search_providers from user_settings "
            "where not ('slippery_hill' = any(search_providers))"
        )
    ).all()
    for settings_id, current in settings:
        # Known services keep the canonical order; unknown values stay after them.
        merged = [s for s in NEW_SERVICES if s in {*current, "slippery_hill"}]
        merged += [s for s in current if s not in NEW_SERVICES]
        conn.execute(
            sa.text(
                # updated_at stays put so a queued offline edit still wins last-write-wins.
                "update user_settings set search_providers = :value, "
                "server_seq = nextval('sync_seq') where id = :id"
            ),
            {"value": merged, "id": settings_id},
        )
    _set_search_default(NEW_SERVICES)


def downgrade() -> None:
    _set_search_default(OLD_SERVICES)
    op.execute(
        "update user_settings set search_providers = array_remove(search_providers, "
        "'slippery_hill'), server_seq = nextval('sync_seq') "
        "where 'slippery_hill' = any(search_providers)"
    )
    op.execute(
        "update recording_links set provider = 'other', provider_ref = null, "
        "updated_at = now(), server_seq = nextval('sync_seq') "
        "where provider = 'slippery_hill'"
    )
    _replace_provider_constraint(OLD_PROVIDERS)
