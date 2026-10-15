import io
from types import SimpleNamespace

import pytest

from dbgpt_app.openapi.api_v1 import agentic_data_api


@pytest.mark.asyncio
async def test_original_source_falls_back_to_knowledge_cache(monkeypatch) -> None:
    source = SimpleNamespace(source_name="paper.pdf")
    references = ["/cache/paper.pdf", "dbgpt-fs://distributed/missing"]
    attempts = []

    class _StorageClient:
        def get_file(self, reference):
            attempts.append(reference)
            if reference == "/cache/paper.pdf":
                return io.BytesIO(b"original-pdf"), SimpleNamespace(file_hash="hash")
            raise FileNotFoundError(reference)

    monkeypatch.setattr(
        agentic_data_api,
        "_citation_access_source",
        lambda *args, **kwargs: source,
    )
    monkeypatch.setattr(
        agentic_data_api, "_citation_original_files", lambda value: references
    )
    monkeypatch.setattr(
        agentic_data_api.FileStorageClient,
        "get_instance",
        lambda system_app: _StorageClient(),
    )

    response = await agentic_data_api.citation_original_source(
        space_id=1,
        document_id=2,
        chunk_id=3,
        user_token=SimpleNamespace(),
    )
    body = b"".join([chunk async for chunk in response.body_iterator])

    assert attempts == references
    assert body == b"original-pdf"
    assert response.media_type == "application/pdf"
    assert response.headers["etag"] == '"hash"'


@pytest.mark.asyncio
async def test_original_source_returns_404_after_all_candidates_fail(
    monkeypatch,
) -> None:
    source = SimpleNamespace(source_name="paper.pdf")

    class _StorageClient:
        def get_file(self, reference):
            raise FileNotFoundError(reference)

    monkeypatch.setattr(
        agentic_data_api,
        "_citation_access_source",
        lambda *args, **kwargs: source,
    )
    monkeypatch.setattr(
        agentic_data_api,
        "_citation_original_files",
        lambda value: ["dbgpt-fs://distributed/missing", "/cache/missing.pdf"],
    )
    monkeypatch.setattr(
        agentic_data_api.FileStorageClient,
        "get_instance",
        lambda system_app: _StorageClient(),
    )

    with pytest.raises(agentic_data_api.HTTPException) as error:
        await agentic_data_api.citation_original_source(
            space_id=1,
            document_id=2,
            chunk_id=3,
            user_token=SimpleNamespace(),
        )

    assert error.value.status_code == 404
