"""Resolve retrieved vector chunks to persisted knowledge documents safely."""

import ast
import fnmatch
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from dbgpt_serve.rag.models.chunk_db import DocumentChunkDao, DocumentChunkEntity
from dbgpt_serve.rag.models.document_db import (
    KnowledgeDocumentDao,
    KnowledgeDocumentEntity,
)
from dbgpt_serve.rag.models.models import KnowledgeSpaceDao, KnowledgeSpaceEntity

_CONTEXT_PREFIX_RE = re.compile(
    r"^\[文件: [^\]]*\](?:\s*\[路径: [^\]]*\])?\s*\n?"
)


@dataclass(frozen=True)
class CitationSource:
    space_id: int
    document_id: int
    chunk_id: int
    source_name: str
    source_type: str
    content: str
    page_number: Optional[int] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    sheet_name: Optional[str] = None
    start_row: Optional[int] = None
    end_row: Optional[int] = None

    def to_citation_dict(self) -> Dict[str, Any]:
        return {
            "knowledgeSpaceId": self.space_id,
            "documentId": self.document_id,
            "chunkId": self.chunk_id,
            "sourceName": self.source_name,
            "sourceType": self.source_type,
            "pageNumber": self.page_number,
            "startLine": self.start_line,
            "endLine": self.end_line,
            "sheetName": self.sheet_name,
            "startRow": self.start_row,
            "endRow": self.end_row,
        }


def _metadata_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    for parser in (json.loads, ast.literal_eval):
        try:
            parsed = parser(value)
            if isinstance(parsed, dict):
                return parsed
        except (SyntaxError, ValueError, TypeError, json.JSONDecodeError):
            continue
    return {}


def _positive_int(value: Any) -> Optional[int]:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _source_type(name: str, doc_type: Optional[str]) -> str:
    suffix = Path(name).suffix.lower()
    normalized_type = (doc_type or "").lower()
    if suffix == ".pdf" or normalized_type == "pdf":
        return "pdf"
    if suffix in {".md", ".mdx", ".markdown"} or normalized_type in {
        "md",
        "markdown",
    }:
        return "markdown"
    if suffix in {".xlsx", ".xls"} or normalized_type in {"excel", "xlsx", "xls"}:
        return "spreadsheet"
    if suffix == ".csv" or normalized_type == "csv":
        return "csv"
    return "text"


def _resolve_space(knowledge_id: Any) -> Optional[KnowledgeSpaceEntity]:
    key = str(knowledge_id).strip()
    query = (
        KnowledgeSpaceEntity(id=int(key))
        if key.isdigit()
        else KnowledgeSpaceEntity(name=key)
    )
    rows = KnowledgeSpaceDao().get_knowledge_space(query)
    return rows[0] if len(rows) == 1 else None


def _build_source(
    space: KnowledgeSpaceEntity,
    document: KnowledgeDocumentEntity,
    chunk: DocumentChunkEntity,
) -> CitationSource:
    metadata = _metadata_dict(chunk.meta_info)
    return CitationSource(
        space_id=int(space.id),
        document_id=int(document.id),
        chunk_id=int(chunk.id),
        source_name=document.doc_name or chunk.doc_name or f"Document {document.id}",
        source_type=_source_type(
            document.doc_name or chunk.doc_name or "",
            document.doc_type or chunk.doc_type,
        ),
        content=chunk.content or "",
        page_number=_positive_int(metadata.get("page") or metadata.get("page_number")),
        start_line=_positive_int(metadata.get("start_line")),
        end_line=_positive_int(metadata.get("end_line")),
        sheet_name=(
            str(metadata.get("sheet_name")).strip()
            if metadata.get("sheet_name")
            else None
        ),
        start_row=_positive_int(metadata.get("start_row") or metadata.get("row")),
        end_row=_positive_int(
            metadata.get("end_row")
            or metadata.get("start_row")
            or metadata.get("row")
        ),
    )


def get_citation_source(
    space_id: int, document_id: int, chunk_id: int
) -> Optional[CitationSource]:
    """Load one chunk and verify the complete space/document/chunk relation."""
    spaces = KnowledgeSpaceDao().get_knowledge_space_by_ids([space_id])
    if len(spaces) != 1:
        return None
    document = KnowledgeDocumentDao().document_by_id(document_id)
    if document is None or document.space != spaces[0].name:
        return None
    chunks = DocumentChunkDao().get_document_chunks(
        DocumentChunkEntity(id=chunk_id), page=1, page_size=2
    )
    if len(chunks) != 1 or chunks[0].document_id != document.id:
        return None
    return _build_source(spaces[0], document, chunks[0])


def resolve_retrieved_chunk(
    knowledge_id: Any, retrieved_chunk: Any
) -> Optional[CitationSource]:
    """Resolve a vector result without trusting its path as lookup authority."""
    space = _resolve_space(knowledge_id)
    if space is None:
        return None

    metadata = _metadata_dict(getattr(retrieved_chunk, "metadata", {}))
    chunk_id = _positive_int(
        getattr(retrieved_chunk, "chunk_id", None) or metadata.get("chunk_id")
    )
    if chunk_id:
        chunks = DocumentChunkDao().get_document_chunks(
            DocumentChunkEntity(id=chunk_id), page=1, page_size=2
        )
        if len(chunks) == 1:
            source = get_citation_source(
                int(space.id), int(chunks[0].document_id), chunk_id
            )
            if source:
                return source

    documents = KnowledgeDocumentDao().get_knowledge_documents(
        KnowledgeDocumentEntity(space=space.name), page=1, page_size=10_000
    )
    document_by_id = {int(document.id): document for document in documents}
    document_ids = list(document_by_id)
    if not document_ids:
        return None

    content = (getattr(retrieved_chunk, "content", None) or "").strip()
    metadata_title = str(metadata.get("title") or "").strip()
    metadata_source = str(metadata.get("source") or "").strip()
    candidates = DocumentChunkDao().get_document_chunks(
        DocumentChunkEntity(), page=1, page_size=100_000, document_ids=document_ids
    )

    # Exact persisted content is authoritative. Internal ingestion metadata is
    # only a tie-breaker and is never returned to the browser.
    exact_matches = [
        candidate
        for candidate in candidates
        if (candidate.content or "").strip() == content
    ]
    if len(exact_matches) != 1 and (metadata_title or metadata_source):
        narrowed = []
        for candidate in exact_matches or candidates:
            candidate_meta = _metadata_dict(candidate.meta_info)
            if (
                metadata_title
                and str(candidate_meta.get("title") or "") == metadata_title
            ):
                narrowed.append(candidate)
            elif (
                metadata_source
                and str(candidate_meta.get("source") or "") == metadata_source
            ):
                narrowed.append(candidate)
        if content:
            narrowed = [
                item for item in narrowed if (item.content or "").strip() == content
            ]
        exact_matches = narrowed

    if len(exact_matches) != 1:
        return None
    chunk = exact_matches[0]
    document = document_by_id.get(int(chunk.document_id))
    return _build_source(space, document, chunk) if document else None


def resolve_file_tool_chunks(
    knowledge_id: Any,
    *,
    path: str = "",
    query: str = "",
    file_pattern: str = "",
    start_line: int = 1,
    end_line: int = 0,
) -> list[CitationSource]:
    """Resolve chunks exposed by ``kb_cat``/``kb_grep`` to stable citations.

    File tools historically flattened persisted chunks into display text and
    thereby discarded the chunk/page identity needed by the original-source
    viewer.  This mirrors their file filtering and virtual-line behavior while
    retaining the authoritative database identities.
    """
    space = _resolve_space(knowledge_id)
    if space is None:
        return []
    documents = KnowledgeDocumentDao().get_knowledge_documents(
        KnowledgeDocumentEntity(space=space.name), page=1, page_size=10_000
    )
    results: list[CitationSource] = []
    normalized_path = path.rstrip("/")
    for document in documents:
        summary = _metadata_dict(document.summary)
        file_path = str(summary.get("file_path") or document.doc_name or "")
        if normalized_path and file_path != normalized_path and not (
            query and file_path.startswith(normalized_path + "/")
        ):
            continue
        if file_pattern and not fnmatch.fnmatch(file_path, file_pattern):
            continue
        chunks = DocumentChunkDao().get_document_chunks(
            DocumentChunkEntity(document_id=document.id), page=1, page_size=100_000
        )
        chunks.sort(
            key=lambda item: _positive_int(
                _metadata_dict(item.meta_info).get("chunk_index")
            )
            or 0
        )
        virtual_line = 1
        for chunk in chunks:
            metadata = _metadata_dict(chunk.meta_info)
            if metadata.get("chunk_type") == "summary":
                continue
            content = _CONTEXT_PREFIX_RE.sub("", chunk.content or "")
            line_count = max(1, len(content.splitlines()))
            chunk_start = virtual_line
            chunk_end = virtual_line + line_count - 1
            virtual_line = chunk_end + 1
            if query:
                if query.casefold() not in content.casefold():
                    continue
            else:
                requested_end = end_line if end_line > 0 else 2**31 - 1
                if chunk_end < max(1, start_line) or chunk_start > requested_end:
                    continue
            results.append(_build_source(space, document, chunk))
    return results
