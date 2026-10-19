#!/usr/bin/env python3
"""Usage: store_frames.py CAPTURE OUT

Frames each capture named in Marketing/store.json under a headline, at the pixel size App Store
Connect takes for its device, and writes the PNG files to OUT/<device>/. CAPTURE holds the exported
test attachments (`attachments/` with its manifest) and the Mac stills (`<name>.png`).
"""

import html
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APPLE = Path(__file__).resolve().parent.parent
FONT = (
    APPLE.parent
    / "site/node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2"
)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# The canvas App Store Connect takes for each device, and how a shot sits on it, in canvas
# pixels: the headline block's height from the top, the gap left under the device, the screen's
# corner radius, the bezel, and the type sizes. The device takes the height that remains.
DEVICES = {
    "iphone": {
        "size": (1320, 2868),
        "head": 700,
        "foot": 90,
        "radius": 120,
        "bezel": 26,
        "headline": 112,
        "sub": 50,
    },
    "ipad": {
        "size": (2752, 2064),
        "head": 400,
        "foot": 60,
        "radius": 40,
        "bezel": 30,
        "headline": 118,
        "sub": 54,
    },
    "mac": {
        "size": (2880, 1800),
        "head": 330,
        "foot": 60,
        "radius": 0,
        "bezel": 0,
        "headline": 112,
        "sub": 52,
    },
}

# The site's brand palette (site/src/styles/tokens.css).
PAGE = """
@font-face { font-family: Schibsted; font-weight: 400 900; src: url('{font}') format('woff2-variations'); }
* { margin: 0; box-sizing: border-box; }
html, body { width: {w}px; height: {h}px; overflow: hidden; }
html { background: #f3f4f4; }
body {
  position: relative;
  background: linear-gradient(180deg, #ffffff 0%, #f3f4f4 100%);
  font-family: Schibsted, 'Helvetica Neue', Arial, sans-serif;
  color: #2d3142;
}
header {
  position: absolute; inset: 0 0 auto 0; height: {head}px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 0 {side}px;
}
h1 {
  font-size: {headline}px; font-weight: 800; line-height: 1.02; letter-spacing: -0.035em;
  text-align: center; text-wrap: balance;
}
p {
  margin-top: {gap}px; font-size: {sub}px; font-weight: 500; line-height: 1.3; color: #4f5d75;
  text-align: center; text-wrap: balance;
}
.device {
  position: absolute; top: {head}px; left: 50%; transform: translateX(-50%);
  padding: {bezel}px; border-radius: {outer}px;
  background: #2d3142; box-shadow: 0 30px 100px rgba(45, 49, 66, 0.26);
}
.device.bare { padding: 0; background: none; border-radius: 24px; overflow: hidden; }
.device img { display: block; height: {screenh}px; border-radius: {radius}px; }
"""


def captures(folder: Path) -> dict[str, Path]:
    """Map each capture name to its PNG, so store.json can name a still by its test.

    Test attachments are named `<capture>_<n>_<id>.png`, and capture names never hold an
    underscore. Mac stills are `<capture>.png` beside the attachments.
    """
    found: dict[str, Path] = {}
    manifest = folder / "attachments/manifest.json"
    if manifest.exists():
        for test in json.loads(manifest.read_text()):
            for item in test.get("attachments", []):
                name = item.get("suggestedHumanReadableName", "")
                if name.endswith(".png"):
                    found[name.split("_")[0]] = (
                        folder / "attachments" / item["exportedFileName"]
                    )
    for still in folder.glob("*.png"):
        found.setdefault(still.stem, still)
    return found


def page(device: str, shot: dict, image: Path) -> str:
    """Lay one shot out as HTML: the headline block on top, the device in the height below."""
    spec = DEVICES[device]
    w, h = spec["size"]
    values = {
        "font": FONT.as_uri(),
        "w": w,
        "h": h,
        "head": spec["head"],
        "side": round(w * 0.07),
        "headline": spec["headline"],
        "sub": spec["sub"],
        "gap": round(spec["sub"] * 0.55),
        "bezel": spec["bezel"],
        "screenh": h - spec["head"] - spec["foot"] - 2 * spec["bezel"],
        "radius": spec["radius"],
        "outer": spec["radius"] + spec["bezel"],
    }
    style = PAGE
    for key, value in values.items():
        style = style.replace("{" + key + "}", str(value))
    bare = " bare" if spec["bezel"] == 0 else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{style}</style></head><body>
<header><h1>{html.escape(shot["headline"])}</h1><p>{html.escape(shot["sub"])}</p></header>
<div class="device{bare}"><img src="{image.as_uri()}"></div></body></html>"""


def render(
    source: Path, out: Path, size: tuple[int, int], *, transparent: bool = False
) -> None:
    """Screenshot an HTML page at exactly `size`, with an alpha channel when `transparent`."""
    w, h = size
    background = "00000000" if transparent else "ffffffff"
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--default-background-color={background}",
            f"--window-size={w},{h}",
            "--virtual-time-budget=3000",
            f"--screenshot={out}",
            source.as_uri(),
        ],
        check=True,
        capture_output=True,
    )


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    capture, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    spec = json.loads((APPLE / "Marketing/store.json").read_text())
    images = captures(capture)
    missing = []
    with tempfile.TemporaryDirectory() as scratch:
        for device, shots in spec.items():
            # Only the device folders, so the preview beside them survives a reframe.
            shutil.rmtree(out / device, ignore_errors=True)
            (out / device).mkdir(parents=True)
            for index, shot in enumerate(shots, start=1):
                image = images.get(shot["capture"])
                if image is None:
                    missing.append(shot["capture"])
                    continue
                source = Path(scratch) / f"{device}-{index}.html"
                source.write_text(page(device, shot, image))
                target = out / device / f"{index:02d}-{shot['capture']}.png"
                render(source, target, DEVICES[device]["size"])
                print(target)
    if missing:
        print("no capture for: " + ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
