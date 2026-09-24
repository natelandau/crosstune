"""SQL text for CHECK constraints, built from the vocabulary enums."""

from __future__ import annotations


def in_list(column: str, values: tuple[str, ...], *, nullable: bool = True) -> str:
    """Build a CHECK constraint clause restricting `column` to one of `values`.

    Args:
        column: The column name to constrain.
        values: The allowed values.
        nullable: Whether a null `column` also satisfies the constraint.

    Returns:
        str: The SQL expression for the constraint.
    """
    escaped = (value.replace("'", "''") for value in values)
    quoted = ", ".join(f"'{value}'" for value in escaped)
    if nullable:
        return f"{column} is null or {column} in ({quoted})"
    return f"{column} in ({quoted})"


def within_list(column: str, values: tuple[str, ...], max_items: int) -> str:
    """Build a CHECK clause restricting an array `column` to `values`, at most `max_items` long.

    Args:
        column: The array column name to constrain.
        values: The allowed element values.
        max_items: The most elements the array may hold.

    Returns:
        str: The SQL expression for the constraint.
    """
    escaped = (value.replace("'", "''") for value in values)
    quoted = ", ".join(f"'{value}'" for value in escaped)
    return f"cardinality({column}) <= {max_items} and {column} <@ array[{quoted}]::varchar[]"
