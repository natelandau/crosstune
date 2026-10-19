#!/usr/bin/env python3
"""Usage: store_preview.py CAPTURE OUT

Cuts the `preview-filter` capture's screen recording into an iPhone App Preview: the app's
footage inside the phone frame the screenshots use, at 886 x 1920 and 30 fps with the silent
stereo track App Store Connect asks for. Writes OUT/iphone-preview.mp4.
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from store_frames import render

NAME = "preview-filter"
WIDTH, HEIGHT, FPS = 886, 1920, 30
# Under App Store Connect's 30 s, so rounding to whole frames never runs over.
LONGEST = 29.5
# The phone on the canvas: its outer box, the bezel, and the screen's corner radius, sized so
# the native 1320 x 2868 footage scales to exactly the screen's width.
PHONE_W, BEZEL, RADIUS = 780, 16, 94
SCREEN_W = PHONE_W - 2 * BEZEL
SCREEN_H = round(SCREEN_W * 2868 / 1320)
PHONE_H = SCREEN_H + 2 * BEZEL
LEFT, TOP = (WIDTH - PHONE_W) // 2, (HEIGHT - PHONE_H) // 2
# The still screen the clip opens on, each still screen between two actions, and the one it
# ends on are held for at least these many seconds; the holds between grow so the clip runs
# about TARGET seconds.
OPEN, HOLD, CLOSE, TARGET = 1.0, 0.9, 2.5, 20.0
# A still screen is one that changes less than this, for at least STILL seconds.
NOISE, STILL = 0.001, 0.5
# The app's launch, which also changes the screen, ends within this many seconds.
LAUNCH = 2.0

# The screenshots' background, and over it a bezel whose screen is a transparent hole, so the
# footage drawn under it shows through with the screen's rounded corners.
BACKGROUND = f"""<!doctype html><html><head><style>
* {{ margin: 0; }} html, body {{ width: {WIDTH}px; height: {HEIGHT}px; overflow: hidden; }}
body {{ background: linear-gradient(180deg, #ffffff 0%, #f3f4f4 100%); }}
</style></head><body></body></html>"""
BEZEL_PAGE = f"""<!doctype html><html><head><style>
* {{ margin: 0; box-sizing: border-box; }}
html, body {{ width: {WIDTH}px; height: {HEIGHT}px; overflow: hidden; background: transparent; }}
div {{ position: absolute; left: {LEFT}px; top: {TOP}px; width: {PHONE_W}px; height: {PHONE_H}px;
  border: {BEZEL}px solid #2d3142; border-radius: {RADIUS + BEZEL}px;
  box-shadow: 0 24px 80px rgba(45, 49, 66, 0.26); }}
</style></head><body><div></div></body></html>"""


def recording(capture: Path) -> Path:
    """Find the preview test's screen recording among the exported attachments."""
    folder = capture / "attachments"
    for test in json.loads((folder / "manifest.json").read_text()):
        if "test_preview_filter" in test["testIdentifier"]:
            video = next(
                i for i in test["attachments"] if i["exportedFileName"].endswith(".mp4")
            )
            return folder / video["exportedFileName"]
    msg = f"no {NAME} capture in {folder}; run just apple::capture-test {NAME}"
    raise SystemExit(msg)


def normalized(video: Path, scratch: Path) -> Path:
    """Re-time the recording at a constant frame rate from zero.

    The simulator's recording drops the frames of a still screen and starts its clock late, so
    finding a moment and cutting there must both read this copy's clock.
    """
    target = scratch / "recording.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-an",
         "-vf", f"setpts=PTS-STARTPTS,fps={FPS}", "-c:v", "libx264", "-crf", "12", str(target)],
        check=True,
    )  # fmt: skip
    return target


def stills(video: Path) -> list[tuple[float, float]]:
    """List the spans where the screen holds still, as (start, end) seconds, in order."""
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(video),
         "-vf", f"freezedetect=n={NOISE}:d={STILL}", "-an", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    starts = [float(t) for t in re.findall(r"freeze_start: ([0-9.]+)", result.stderr)]
    ends = [float(t) for t in re.findall(r"freeze_end: ([0-9.]+)", result.stderr)]
    # The last still runs to the end of the recording, which reports no end of its own.
    ends += [duration(video)] * (len(starts) - len(ends))
    return list(zip(starts, ends, strict=True))


def duration(video: Path) -> float:
    """Read a video's length in seconds."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    return float(result.stdout)


def spans(video: Path) -> list[tuple[float, float]]:
    """Choose the spans of the recording the clip keeps, as (start, end) seconds.

    The clip runs from the loaded catalog to the end. Each action plays at its own pace, and
    each still screen after one is cut to a hold, since the test's waits are not the story.
    """
    # The blank screen the app shows while the catalog opens starts within the launch, so the
    # first still that starts after it is the loaded catalog.
    found = [(start, end) for start, end in stills(video) if start > LAUNCH]
    if len(found) < 2:
        msg = f"{video} holds still {len(found)} times after the launch; the preview needs the catalog and an action"
        raise SystemExit(msg)
    first, rest = found[0], found[1:]
    moving = sum(nxt[0] - cur[1] for cur, nxt in zip(found, rest, strict=False))
    between = len(rest) - 1
    hold = max(HOLD, (TARGET - OPEN - CLOSE - moving) / between) if between else HOLD
    kept = [(max(first[0], first[1] - OPEN), first[1])]
    previous = first[1]
    for index, (start, end) in enumerate(rest):
        kept.append((previous, start))
        keep = CLOSE if index == len(rest) - 1 else hold
        kept.append((start, min(end, start + keep)))
        previous = end
    return [(a, b) for a, b in kept if b - a > 1 / FPS]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    capture, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    video = recording(capture)
    with tempfile.TemporaryDirectory() as folder:
        scratch = Path(folder)
        retimed = normalized(video, scratch)
        kept = spans(retimed)
        length = sum(end - start for start, end in kept)
        if not 15 <= length <= LONGEST:
            msg = f"the preview runs {length:.1f} s; App Store Connect takes 15 to 30 s"
            raise SystemExit(msg)
        picked = "+".join(f"between(t,{start:.3f},{end:.3f})" for start, end in kept)
        pngs = []
        for name, page in (("background", BACKGROUND), ("bezel", BEZEL_PAGE)):
            source = scratch / f"{name}.html"
            source.write_text(page)
            png = scratch / f"{name}.png"
            render(source, png, (WIDTH, HEIGHT), transparent=name == "bezel")
            pngs.append(png)
        graph = ";".join(
            [
                f"[1:v]fps={FPS},trim=duration={length:.3f}[bg]",
                (
                    f"[0:v]select='{picked}',setpts=N/{FPS}/TB,"
                    f"scale={SCREEN_W}:{SCREEN_H}[app]"
                ),
                f"[bg][app]overlay={LEFT + BEZEL}:{TOP + BEZEL}[framed]",
                "[framed][2:v]overlay=0:0,format=yuv420p[v]",
            ]
        )
        # A constant rate in App Store Connect's 10 to 12 Mbps, which a mostly still screen
        # would otherwise fall far below.
        target = out / "iphone-preview.mp4"
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(retimed),
                "-loop", "1", "-i", str(pngs[0]), "-loop", "1", "-i", str(pngs[1]),
                "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-filter_complex", graph, "-map", "[v]", "-map", "3:a",
                "-t", f"{length:.3f}", "-r", str(FPS), "-c:v", "libx264", "-profile:v", "high",
                "-level", "4.0", "-b:v", "11M", "-minrate", "11M", "-maxrate", "11M", "-bufsize", "11M",
                "-x264-params", "nal-hrd=cbr",
                "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(target),
            ],
            check=True,
        )  # fmt: skip
    print(target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
