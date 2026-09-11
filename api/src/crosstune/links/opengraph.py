"""Minimal Open Graph extraction with the standard library parser."""

from __future__ import annotations

from html.parser import HTMLParser


class OpenGraphParser(HTMLParser):
    """Collects og:title, og:image, and the <title> text."""

    def __init__(self) -> None:
        super().__init__()
        self.og_title: str | None = None
        self.og_image: str | None = None
        self.title: str | None = None
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Capture og:title and og:image from a meta tag, and note entry into <title>."""
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

    def handle_endtag(self, tag: str) -> None:
        """Note exit from <title>."""
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        """Accumulate text inside <title>."""
        if self._in_title and data.strip():
            self.title = (self.title or "") + data.strip()


def parse_open_graph(html: str) -> tuple[str | None, str | None]:
    """(title, image_url) from a page, preferring Open Graph over the title tag."""
    parser = OpenGraphParser()
    parser.feed(html)
    return parser.og_title or parser.title, parser.og_image
