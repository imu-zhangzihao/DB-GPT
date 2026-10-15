import json
import unittest

from dbgpt_app.openapi.api_v1.tools.kb_tools import (
    _apply_semantic_citation_registry,
)


def _result(chunk_id: int, local_index: int = 1) -> str:
    return json.dumps(
        {
            "chunks": [
                {
                    "output_type": "markdown",
                    "content": f"### Result {local_index} [paper.pdf]\ntext",
                }
            ],
            "citations": [
                {
                    "chunkIndex": local_index,
                    "knowledgeSpaceId": 1,
                    "documentId": 2,
                    "chunkId": chunk_id,
                    "sourceName": "paper.pdf",
                    "excerpt": "text",
                }
            ],
        }
    )


class CitationRegistryTest(unittest.TestCase):
    def test_reuses_numbers_and_keeps_multiple_calls_global(self):
        registry = {}
        first = json.loads(_apply_semantic_citation_registry(_result(10), registry))
        second = json.loads(_apply_semantic_citation_registry(_result(20), registry))
        repeated = json.loads(_apply_semantic_citation_registry(_result(10), registry))

        self.assertEqual(first["citations"][0]["index"], 1)
        self.assertEqual(second["citations"][0]["index"], 2)
        self.assertIn("### Result 2", second["chunks"][0]["content"])
        self.assertEqual(repeated["citations"][0]["index"], 1)
        self.assertEqual(len(registry), 2)

    def test_assigns_indexes_without_semantic_chunks_wrapper(self):
        registry = {}
        payload = json.dumps(
            {
                "content": "file tool output",
                "citations": [
                    {
                        "knowledgeSpaceId": 1,
                        "documentId": 2,
                        "chunkId": 30,
                        "sourceName": "paper.pdf",
                        "excerpt": "evidence",
                    }
                ],
            }
        )

        result = json.loads(_apply_semantic_citation_registry(payload, registry))

        self.assertEqual(result["citations"][0]["index"], 1)


if __name__ == "__main__":
    unittest.main()
