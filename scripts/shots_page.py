#!/usr/bin/env python3
"""Builds index.html in a review folder from each platform's diff manifest.

Each platform folder holds before/, after/, diff/, and manifest.json from
web/scripts/shots-diff.ts. The page links the images by relative path, so the folder can be
opened or published as it is.
"""

import argparse
import html
import json
from pathlib import Path
from typing import NotRequired, TypedDict


class Shot(TypedDict):
    """One entry of a diff manifest's shots."""

    path: str
    status: str
    ratio: NotRequired[float]


TITLES = {"web": "Web", "mac": "Mac", "ios": "iPhone and iPad"}

STYLE = """
body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 24px; color: #1c1c1e; }
header { margin-bottom: 24px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; border-bottom: 1px solid #d1d1d6; padding-bottom: 4px; }
h3 { font-size: 14px; margin: 20px 0 6px; font-family: ui-monospace, monospace; }
.meta, .note { color: #6e6e73; }
.row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
.row.single { grid-template-columns: 1fr 2fr; }
figure { margin: 0; }
figcaption { font-size: 12px; color: #6e6e73; margin-bottom: 4px; }
img { width: 100%; border: 1px solid #d1d1d6; }
"""


def figure(label: str, src: str) -> str:
    """One captioned image linked to its full size."""
    src = html.escape(src)
    return f'<figure><figcaption>{label}</figcaption><a href="{src}"><img src="{src}" loading="lazy" alt="{label}"></a></figure>'


def shot_row(folder: Path, platform: str, shot: Shot) -> str:
    """The before, after, and diff images of one shot, or the one side it has."""
    path = shot["path"]
    status = shot["status"]
    if status == "added":
        heading = f"{html.escape(path)} (added)"
        images = figure(label="After", src=f"{platform}/after/{path}")
        return f'<h3>{heading}</h3><div class="row single">{images}</div>'
    if status == "removed":
        heading = f"{html.escape(path)} (removed)"
        images = figure(label="Before", src=f"{platform}/before/{path}")
        return f'<h3>{heading}</h3><div class="row single">{images}</div>'
    ratio = shot.get("ratio", 1.0)
    share = f"{ratio * 100:.2f}% of pixels changed"
    images = figure(label="Before", src=f"{platform}/before/{path}") + figure(
        label="After", src=f"{platform}/after/{path}"
    )
    # A pair of different sizes has no diff image.
    if (folder / platform / "diff" / path).exists():
        images += figure(label="Changed pixels", src=f"{platform}/diff/{path}")
    return f'<h3>{html.escape(path)} <span class="meta">{share}</span></h3><div class="row">{images}</div>'


def platform_section(folder: Path, platform: str) -> str:
    """The heading and rows of one platform, or a line saying nothing changed."""
    title = TITLES.get(platform, platform)
    manifest_path = folder / platform / "manifest.json"
    if not manifest_path.exists():
        return f"<h2>{title}</h2><p class='note'>Not captured.</p>"
    manifest = json.loads(manifest_path.read_text())
    shots: list[Shot] = manifest["shots"]
    summary = f"{len(shots)} changed, {manifest['same']} unchanged"
    if not shots:
        return (
            f"<h2>{title}</h2><p class='note'>No shot changed ({manifest['same']} unchanged).</p>"
        )
    rows = "".join(shot_row(folder=folder, platform=platform, shot=shot) for shot in shots)
    return f"<h2>{title} <span class='meta'>{summary}</span></h2>{rows}"


def main() -> None:
    """Write index.html from the arguments and the manifests."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--platforms", required=True, help="space separated")
    parser.add_argument("--note", nargs="*", default=[])
    parser.add_argument(
        "--dirty",
        action="store_true",
        help="the branch shots include uncommitted changes",
    )
    args = parser.parse_args()

    platforms = args.platforms.split()
    sections = "".join(
        platform_section(folder=args.folder, platform=platform) for platform in platforms
    )
    notes = "".join(f"<p class='note'>{html.escape(note)}</p>" for note in args.note)
    branch = html.escape(args.branch)
    meta = f"Base {args.base[:10]}, head {args.head[:10]}"
    if args.dirty:
        meta += " with uncommitted changes included"
    page = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>UI review: {branch}</title><style>{STYLE}</style></head>
<body>
<header><h1>UI review: {branch}</h1><p class="meta">{meta}</p>{notes}</header>
{sections}
</body>
</html>
"""
    (args.folder / "index.html").write_text(page)


if __name__ == "__main__":
    main()
