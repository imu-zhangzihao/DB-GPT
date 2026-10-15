from types import SimpleNamespace
import unittest
from unittest.mock import patch

from dbgpt_serve.rag.tools import citation_source


class _SpaceDao:
    def get_knowledge_space(self, query):
        return [SimpleNamespace(id=7, name="papers")]

    def get_knowledge_space_by_ids(self, ids):
        return [SimpleNamespace(id=7, name="papers")] if ids == [7] else []


class _DocumentDao:
    document = SimpleNamespace(
        id=11,
        space="papers",
        doc_name="ByteTrack.pdf",
        doc_type="DOCUMENT",
        summary="{}",
    )

    def document_by_id(self, document_id):
        return self.document if document_id == 11 else None

    def get_knowledge_documents(self, query, page=1, page_size=20):
        return [self.document]


class _ChunkDao:
    chunk = SimpleNamespace(
        id=23,
        document_id=11,
        doc_name="ByteTrack.pdf",
        doc_type="DOCUMENT",
        content="original indexed fragment",
        meta_info="{'page': 4, 'source': '/private/cache/internal.pdf'}",
    )

    def get_document_chunks(self, query, page=1, page_size=20, document_ids=None):
        if query.id is not None:
            return [self.chunk] if query.id == 23 else []
        if query.document_id == 11:
            return [self.chunk]
        return [self.chunk] if document_ids == [11] else []


def _reset_chunk():
    _DocumentDao.document = SimpleNamespace(
        id=11,
        space="papers",
        doc_name="ByteTrack.pdf",
        doc_type="DOCUMENT",
        summary="{}",
    )
    _ChunkDao.chunk = SimpleNamespace(
        id=23,
        document_id=11,
        doc_name="ByteTrack.pdf",
        doc_type="DOCUMENT",
        content="original indexed fragment",
        meta_info="{'page': 4, 'source': '/private/cache/internal.pdf'}",
    )


class CitationSourceTest(unittest.TestCase):
    def setUp(self):
        _reset_chunk()
        self.patches = [
            patch.object(citation_source, "KnowledgeSpaceDao", _SpaceDao),
            patch.object(citation_source, "KnowledgeDocumentDao", _DocumentDao),
            patch.object(citation_source, "DocumentChunkDao", _ChunkDao),
        ]
        for active_patch in self.patches:
            active_patch.start()

    def tearDown(self):
        for active_patch in reversed(self.patches):
            active_patch.stop()

    def test_resolves_vector_chunk_to_verified_pdf_source(self):
        retrieved = SimpleNamespace(
            content="original indexed fragment",
            metadata={"title": "opaque-ingestion-id", "page": 4},
        )

        source = citation_source.resolve_retrieved_chunk("papers", retrieved)

        self.assertIsNotNone(source)
        self.assertEqual(source.space_id, 7)
        self.assertEqual(source.document_id, 11)
        self.assertEqual(source.chunk_id, 23)
        self.assertEqual(source.source_name, "ByteTrack.pdf")
        self.assertEqual(source.source_type, "pdf")
        self.assertEqual(source.page_number, 4)

    def test_rejects_cross_document_chunk_relationship(self):
        _ChunkDao.chunk = SimpleNamespace(
            id=23,
            document_id=99,
            doc_name="foreign.pdf",
            doc_type="DOCUMENT",
            content="foreign",
            meta_info="{}",
        )

        self.assertIsNone(citation_source.get_citation_source(7, 11, 23))

    def test_normalizes_spreadsheet_source_location(self):
        _DocumentDao.document = SimpleNamespace(
            id=11, space="papers", doc_name="metrics.xlsx", doc_type="DOCUMENT"
        )
        _ChunkDao.chunk = SimpleNamespace(
            id=23,
            document_id=11,
            doc_name="metrics.xlsx",
            doc_type="DOCUMENT",
            content="name: tracker\nscore: 80.3",
            meta_info='{"sheet_name": "Results", "row": 12}',
        )

        source = citation_source.get_citation_source(7, 11, 23)

        self.assertIsNotNone(source)
        self.assertEqual(source.source_type, "spreadsheet")
        self.assertEqual(source.sheet_name, "Results")
        self.assertEqual(source.start_row, 12)
        self.assertEqual(source.end_row, 12)

    def test_file_tool_match_preserves_pdf_chunk_and_page(self):
        sources = citation_source.resolve_file_tool_chunks(
            "papers", path="ByteTrack.pdf", query="indexed fragment"
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].chunk_id, 23)
        self.assertEqual(sources[0].page_number, 4)


if __name__ == "__main__":
    unittest.main()
