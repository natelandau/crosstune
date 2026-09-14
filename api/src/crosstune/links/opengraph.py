"""Minimal Open Graph extraction with the standard library parser."""

from __future__ import annotations

import json
from dataclasses import dataclass
from html.parser import HTMLParser

BANDCAMP_ITEM_TYPES = {"a": "album", "t": "track"}


@dataclass(frozen=True)
class PageMeta:
    """What a page's head says about the recording it hosts."""

    title: str | None
    image: str | None
    bandcamp_ref: str | None


def _bandcamp_ref(content: str) -> str | None:
    try:
        props = json.loads(content)
    except ValueError:
        return None
    if not isinstance(props, dict):
        return None
    kind = BANDCAMP_ITEM_TYPES.get(props.get("item_type"))
    item_id = props.get("item_id")
    if kind is None or type(item_id) is not int:
        return None
    return f"{kind}:{item_id}"


class OpenGraphParser(HTMLParser):
    """Collects og:title, og:image, Bandcamp's page properties, and the <title> text."""

    def __init__(self) -> None:
        super().__init__()
        self.og_title: str | None = None
        self.og_image: str | None = None
        self.bandcamp_ref: str | None = None
        self.title: str | None = None
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Capture the meta tags a resolver reads, and note entry into <title>."""
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        attr = dict(attrs)
        prop = attr.get("property") or attr.get("name")
        content = attr.get("content")
        if not content:
            return
        if prop == "og:title" and self.og_title is None:
            self.og_title = content.strip()
        elif prop == "og:image" and self.og_image is None:
            self.og_image = content.strip()
        elif prop == "bc-page-properties" and self.bandcamp_ref is None:
            self.bandcamp_ref = _bandcamp_ref(content)

    def handle_endtag(self, tag: str) -> None:
        """Note exit from <title>."""
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        """Accumulate text inside <title>."""
        if self._in_title and data.strip():
            self.title = (self.title or "") + data.strip()


def parse_open_graph(html: str) -> PageMeta:
    """Read a page's title, image, and Bandcamp embed id, preferring Open Graph over the title tag."""
    parser = OpenGraphParser()
    parser.feed(html)
    return PageMeta(
        title=parser.og_title or parser.title,
        image=parser.og_image,
        bandcamp_ref=parser.bandcamp_ref,
    )
