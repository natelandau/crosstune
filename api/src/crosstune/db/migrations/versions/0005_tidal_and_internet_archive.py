"""tidal and internet archive providers, and re-detect links saved as other

Revision ID: 0005
Revises: 0004
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

OLD_PROVIDERS = ("youtube", "spotify", "apple_music", "bandcamp", "soundcloud", "other")
NEW_PROVIDERS = (
    "youtube",
    "spotify",
    "apple_music",
    "bandcamp",
    "soundcloud",
    "tidal",
    "internet_archive",
    "other",
)

# A frozen copy of the matching rules at this revision, so later changes to
# crosstune.links.detect never change what this migration does.
TIDAL_PATH = re.compile(
    r"^/(?:browse/)?(?:album/\d+/)?(track|album|playlist|video)/([0-9A-Fa-f-]+)"
)
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def redetect(url: str) -> tuple[str, str | None, str] | None:
    """Identify a TIDAL or YouTube Music URL that was saved as a plain link.

    Args:
        url: The stored URL of a link whose provider is `other`.

    Returns:
        tuple[str, str | None, str] | None: The provider, provider ref, and canonical URL,
            or None when the URL belongs to neither service.
    """
    try:
        parts = urlparse(url)
    except ValueError:
        return None
    host = (parts.hostname or "").lower().removeprefix("www.")
    if host in {"tidal.com", "listen.tidal.com"}:
        match = TIDAL_PATH.match(parts.path)
        if not match:
            return "tidal", None, url
        kind, item_id = match.groups()
        return "tidal", f"{kind}:{item_id}", f"https://tidal.com/{kind}/{item_id}"
    if host == "music.youtube.com" and parts.path == "/watch":
        video = parse_qs(parts.query).get("v", [""])[0]
        if YOUTUBE_ID.match(video):
            return "youtube", video, f"https://www.youtube.com/watch?v={video}"
    return None


def _replace_provider_constraint(providers: tuple[str, ...]) -> None:
    op.drop_constraint("ck_recording_links_provider", "recording_links", type_="check")
    quoted = ", ".join(f"'{provider}'" for provider in providers)
    op.create_check_constraint(
        "ck_recording_links_provider", "recording_links", f"provider in ({quoted})"
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


def downgrade() -> None:
    op.execute(
        "update recording_links set provider = 'other', provider_ref = null, "
        "updated_at = now(), server_seq = nextval('sync_seq') "
        "where provider in ('tidal', 'internet_archive')"
    )
    _replace_provider_constraint(OLD_PROVIDERS)
