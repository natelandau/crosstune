"""The OpenAPI document is the contract the web client is generated from."""

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
        "SongRow",
        "UserSongRow",
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
    assert "table" in schemas["SongPullRow"]["required"]
    assert "table" in schemas["SongChangeResult"]["required"]
