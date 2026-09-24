"""Both tune shapes, while clients that predate part modes and tune types are in use.

Delete this module, and its call in push, once no client sends `feel` or `mode`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Collection

LEGACY_FIELDS = frozenset({"feel", "mode"})


def reconcile_tune(data: dict[str, Any], sent: Collection[str]) -> dict[str, Any]:
    """Fill both shapes of a validated tune from whichever one the sender edits.

    Args:
        data: The validated tune fields, as `TuneData.model_dump()` returns them.
        sent: The field names the client actually sent.

    Returns:
        dict[str, Any]: The fields with `tune_type`, `modes`, `feel`, and `mode` consistent.
    """
    out = dict(data)
    pulled_modes = list(out.get("modes") or [])
    if LEGACY_FIELDS & set(sent):
        # An old client edits only feel and mode; its tune_type and modes are stale pulls.
        out["tune_type"] = out.get("feel")
        first = out.get("mode")
        out["modes"] = [first, *pulled_modes[1:]] if first else []
    else:
        out["modes"] = pulled_modes
        out["feel"] = out.get("tune_type")
        out["mode"] = pulled_modes[0] if pulled_modes else None
    return out
