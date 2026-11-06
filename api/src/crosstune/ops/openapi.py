"""Write the OpenAPI document every client generates its types from.

Run as `just api::contract`, which writes api/openapi.json, or by the contract checks,
which compare a fresh export with the committed file.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from crosstune.main import create_app


def render() -> str:
    """Render the app's OpenAPI document with sorted keys, so an export is byte-stable.

    Returns:
        str: The document as indented JSON with a trailing newline.
    """
    return json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    """Write the document to the path given on the command line."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path, help="the file to write")
    args = parser.parse_args()
    args.out.write_text(render())


if __name__ == "__main__":
    main()
