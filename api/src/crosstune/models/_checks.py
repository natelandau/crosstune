"""SQL text for CHECK constraints, built from the models' shared value tuples."""

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
