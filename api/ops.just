# Operator commands: they read or change accounts in whatever database api/.env or the
# Railway environment names, so they stay apart from the development recipes. Loaded as
# the `ops` module by the root justfile and run from api/. Each forwards its arguments to
# its CLI; `--help` after a subcommand lists that subcommand's options.

import '../scripts/settings.just'

[default]
_default:
    @just --list ops

# Comp an account, move a trial, or refund
[group('billing')]
[arg("args", help="A subcommand (comp, trial, or withdraw) and its arguments")]
billing *args:
    uv run python -m crosstune.ops.billing "$@"

# Count accounts by country or client version
[group('billing')]
[arg("args", help="A subcommand (countries or versions) and its arguments")]
stats *args:
    uv run python -m crosstune.ops.stats "$@"

# Re-name recordings the server named
[group('accounts')]
[arg("args", help="A subcommand (rename-automatic) and its arguments")]
places *args:
    uv run python -m crosstune.ops.places "$@"

# Email every account about a policy change
[group('accounts')]
[arg("args", help="--subject, --key, and --body")]
notify-accounts *args:
    uv run python -m crosstune.ops.notify_accounts "$@"

# Preview, test, or run inactivity warnings
[group('accounts')]
[arg("args", help="A subcommand (preview, send-test, or run) and its arguments")]
inactivity *args:
    uv run python -m crosstune.ops.inactivity "$@"

# Run inactivity warnings on Railway development
[group('accounts')]
[arg("args", help="A subcommand (preview, send-test, or run) and its arguments")]
inactivity-railway *args:
    railway ssh --environment development --service crosstune -- python -m crosstune.ops.inactivity "$@"
