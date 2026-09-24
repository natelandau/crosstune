"""The OpenAPI document is the contract the web client is generated from."""

from crosstune import vocabulary
from crosstune.main import create_app


def test_openapi_lists_every_public_route() -> None:
    paths = set(create_app().openapi()["paths"])
    assert {
        "/v1/me",
        "/v1/sync/push",
        "/v1/sync/pull",
        "/v1/links/resolve",
        "/v1/recordings/{recording_id}/upload-slot",
        "/v1/recordings/{recording_id}/uploaded",
        "/v1/recordings/{recording_id}/retry",
        "/v1/recordings/{recording_id}/download",
    } <= paths
    assert "/healthz" not in paths
    assert "/v1/webhooks/clerk" not in paths


def test_openapi_is_deterministic() -> None:
    assert create_app().openapi() == create_app().openapi()


def test_openapi_types_every_table_row() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    assert {
        "TuneRow",
        "UserTuneRow",
        "RecordingLinkRow",
        "RecordingRow",
        "ListRow",
        "ListItemRow",
        "UserSettingsRow",
    } <= set(schemas)


def test_openapi_documents_validation_failures_as_problems() -> None:
    doc = create_app().openapi()
    content = doc["paths"]["/v1/sync/push"]["post"]["responses"]["422"]["content"]
    assert list(content) == ["application/problem+json"]
    assert content["application/problem+json"]["schema"]["$ref"].endswith("/Problem")
    assert "HTTPValidationError" not in doc["components"]["schemas"]


def test_openapi_documents_the_recording_states_a_client_branches_on() -> None:
    responses = create_app().openapi()["paths"]["/v1/recordings/{recording_id}/upload-slot"][
        "post"
    ]["responses"]
    for status in ("409", "413", "503"):
        content = responses[status]["content"]
        assert list(content) == ["application/problem+json"]
        assert content["application/problem+json"]["schema"]["$ref"].endswith("/Problem")


def test_openapi_rows_carry_a_required_discriminator() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    assert "table" in schemas["TunePullRow"]["required"]
    assert "table" in schemas["TuneChangeResult"]["required"]


def test_openapi_publishes_every_vocabulary_as_a_named_enum() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    for enum in (
        vocabulary.Instrument,
        vocabulary.TuneStatus,
        vocabulary.Mode,
        vocabulary.TimeSignature,
        vocabulary.Provider,
        vocabulary.AudioQuality,
        vocabulary.RecordingSource,
        vocabulary.RecordingState,
    ):
        assert schemas[enum.__name__]["enum"] == [member.value for member in enum], enum.__name__
        assert schemas[enum.__name__]["type"] == "string"


def test_openapi_publishes_every_limit_on_its_row() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    rows = {
        "tunes": "TuneRow",
        "user_tunes": "UserTuneRow",
        "lists": "ListRow",
        "recording_links": "RecordingLinkRow",
        "recordings": "RecordingRow",
    }
    for table, fields in vocabulary.LIMITS.items():
        properties = schemas[rows[table]]["properties"]
        for field, limit in fields.items():
            prop = properties[field]
            candidates = [prop, *prop.get("anyOf", []), prop.get("items", {})]
            assert limit in {c.get("maxLength") for c in candidates}, f"{table}.{field}"


def test_openapi_types_each_instrument_in_the_tunings_map() -> None:
    doc = create_app().openapi()

    def resolve(schema: dict) -> dict:
        if "anyOf" in schema:
            schema = next(s for s in schema["anyOf"] if s.get("type") != "null")
        while "$ref" in schema:
            schema = doc["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
        return schema

    tunings = resolve(doc["components"]["schemas"]["TuneRow"]["properties"]["tunings"])
    assert set(tunings["properties"]) == {i.value for i in vocabulary.Instrument}
    assert "capo" not in resolve(tunings["properties"]["violin"])["properties"]
    assert "capo" in resolve(tunings["properties"]["five_string_banjo"])["properties"]


def test_a_tune_row_always_carries_its_modes() -> None:
    row = create_app().openapi()["components"]["schemas"]["TuneRow"]
    assert "modes" in row["required"]
    assert row["properties"]["modes"]["type"] == "array"
    assert not {"feel", "mode"} & set(row["properties"])
