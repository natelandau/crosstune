"""Mark an API dataclass as safe to show in error reports.

Error reports redact every dataclass the API defines unless its class carries this mark.
"""

from __future__ import annotations

REPORTABLE_ATTRIBUTE = "__reportable__"


def reportable[T: type](cls: T) -> T:
    """Show the dataclass's fields in error reports, for a type whose every field is safe.

    Args:
        cls: The dataclass to show.

    Returns:
        The same class, marked.
    """
    setattr(cls, REPORTABLE_ATTRIBUTE, True)
    return cls
