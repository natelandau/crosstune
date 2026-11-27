# Shared fixtures

Each folder holds the cases for one rule that the web client, the Apple app, or the API implement separately. Every implementation reads the same cases, so a change on one side that the others do not follow fails a test.

## Case files

A case file is one JSON object, one case per file. The case name is the file name without `.json`. A case has these fields:

- `description`: what the case checks, in a sentence. Not empty.
- `input`: a JSON object with the data passed to the rule.
- `expected`: an object holding the result every platform must produce.
- `platform_overrides`: optional, an object when present. A `null` value is rejected. Keys are `web`, `apple`, or `api`. Each holds a `reason` that names the rule in `docs/architecture.md` or the code, and a `fields` object with the values that differ on that platform. Each field replaces the `expected` field of the same name and must already exist there. A loader rejects any other top-level key, any other platform key, an override without a `reason` or `fields`, and a folder with no case.

Rows use the wire field names from `api/openapi.json`. Timestamps are ISO 8601 UTC strings with milliseconds.

A folder may keep its own format. Its own `README.md` says how.

## Manifest

`manifest.json` has one entry per folder under `rules`:

- `sources`: the implementation files that apply the rule.
- `readers`: the test files and helpers that read the cases.
- `apple_suites`: the Swift Testing suites that read the cases, as `<TestTarget>/<SuiteName>`. CI runs these.

All paths are relative to the repository root. `scripts/tests/test_fixtures_manifest.py` checks that every listed file exists, every reader reaches its folder, and every folder has an entry.

## Changing a rule

A change to a listed source updates the cases and every other listed source in the same change. Add a new folder to the manifest in the commit that creates it.
