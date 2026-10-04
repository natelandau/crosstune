"""Read a Slippery-Hill tune page: the Drupal site has no API and no Open Graph tags."""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from crosstune.links.detect import SLIPPERY_HILL_ORIGIN, slippery_hill_ref

TITLE_SUFFIX = " | Slippery-Hill"
HOSTS = frozenset({"www.slippery-hill.com", "slippery-hill.com"})
TUNE_FIELD = "field--name-field-r-tune-title"
SOURCE_FIELD = "field--name-field-r-source"
# Some pages keep the artist in this taxonomy field instead of the link field.
SOURCE_TERM_FIELD = "field--name-field-r-source-term"
UPLOAD_FIELD = "field--name-field-r-uploaded-file"
FIELDS = (TUNE_FIELD, SOURCE_FIELD, SOURCE_TERM_FIELD)


@dataclass(frozen=True)
class TunePage:
    """What a tune page says about its recording."""

    title: str | None
    ref: str | None


class _TunePageParser(HTMLParser):
    """Track div depth to collect the first item of each title and artist field."""

    def __init__(self) -> None:
        super().__init__()
        self.page_title: str | None = None
        self.upload_ref: str | None = None
        self.any_ref: str | None = None
        self.fields: dict[str, str] = {}
        self._in_title = False
        self._depth = 0
        self._upload_depth: int | None = None
        self._field: str | None = None
        self._field_depth = 0
        self._item_depth: int | None = None
        self._item_done = False
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Start a field or item on the matching div, and read audio sources."""
        attr = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag in {"audio", "source"}:
            ref = _file_ref(attr.get("src"))
            if self._upload_depth is not None:
                self.upload_ref = self.upload_ref or ref
            self.any_ref = self.any_ref or ref
        elif tag == "div":
            self._depth += 1
            classes = set((attr.get("class") or "").split())
            if self._upload_depth is None and UPLOAD_FIELD in classes:
                self._upload_depth = self._depth
            if self._field is None:
                for name in FIELDS:
                    if name in classes:
                        self._field = name
                        self._field_depth = self._depth
                        self._item_done = False
                        break
            elif self._item_depth is None and not self._item_done and "field__item" in classes:
                self._item_depth = self._depth
                self._text = []

    def handle_endtag(self, tag: str) -> None:
        """Close the item or field when its own div closes."""
        if tag == "title":
            self._in_title = False
        elif tag == "div":
            if self._item_depth == self._depth and self._field is not None:
                text = " ".join("".join(self._text).split())
                if text:
                    self.fields.setdefault(self._field, text)
                self._item_depth = None
                self._item_done = True
            if self._field is not None and self._field_depth == self._depth:
                self._field = None
            if self._upload_depth == self._depth:
                self._upload_depth = None
            self._depth -= 1

    def handle_data(self, data: str) -> None:
        """Accumulate the title tag and the open item's text."""
        if self._in_title:
            self.page_title = (self.page_title or "") + data
        if self._item_depth is not None:
            self._text.append(data)


def _file_ref(src: str | None) -> str | None:
    if not src:
        return None
    parts = urlsplit(urljoin(SLIPPERY_HILL_ORIGIN, src))
    if parts.hostname not in HOSTS:
        return None
    return slippery_hill_ref(parts.path)


def parse_tune_page(html: str) -> TunePage:
    """Read a tune's title and audio file ref so a pasted page link names its recording.

    The title joins the tune and artist fields, falls back to the `<title>` tag
    without its site suffix, and the ref is the audio source in the uploaded-file field,
    else the first one anywhere, on the site's own host.
    """
    parser = _TunePageParser()
    parser.feed(html)
    artist = parser.fields.get(SOURCE_FIELD) or parser.fields.get(SOURCE_TERM_FIELD)
    parts = [text for text in (parser.fields.get(TUNE_FIELD), artist) if text]
    title: str | None = " - ".join(parts) or None
    if title is None and parser.page_title:
        title = parser.page_title.strip().removesuffix(TITLE_SUFFIX).strip() or None
    return TunePage(title=title, ref=parser.upload_ref or parser.any_ref)
