"""SQL text for CHECK constraints, built from the vocabulary enums."""

from __future__ import annotations


def _quoted(values: tuple[str, ...]) -> str:
    """The values as a comma-separated list of SQL string literals."""
    return ", ".join("'{}'".format(value.replace("'", "''")) for value in values)


def in_list(column: str, values: tuple[str, ...], *, nullable: bool = True) -> str:
    """Build a CHECK constraint clause restricting `column` to one of `values`.

    Args:
        column: The column name to constrain.
        values: The allowed values.
        nullable: Whether a null `column` also satisfies the constraint.

    Returns:
        str: The SQL expression for the constraint.
    """
    quoted = _quoted(values)
    if nullable:
        return f"{column} is null or {column} in ({quoted})"
    return f"{column} in ({quoted})"


def between(column: str, low: int, high: int) -> str:
    """Build a CHECK clause restricting `column` to the inclusive range `low` to `high`.

    Args:
        column: The column name to constrain.
        low: The lowest allowed value.
        high: The highest allowed value.

    Returns:
        str: The SQL expression for the constraint.
    """
    return f"{column} between {low} and {high}"


def within_list(column: str, values: tuple[str, ...], max_items: int) -> str:
    """Build a CHECK clause restricting an array `column` to `values`, at most `max_items` long.

    Args:
        column: The array column name to constrain.
        values: The allowed element values.
        max_items: The most elements the array may hold.

    Returns:
        str: The SQL expression for the constraint.
    """
    quoted = _quoted(values)
    return f"cardinality({column}) <= {max_items} and {column} <@ array[{quoted}]::varchar[]"
