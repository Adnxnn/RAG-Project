from __future__ import annotations

from collections import defaultdict

from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder, SentenceTransformer

from app.core.config import settings
from app.core.models import KnowledgeBlock


class HybridRetriever:
    def __init__(self) -> None:
        self.embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        self.reranker: CrossEncoder | None = None
        self.blocks_by_conversation: dict[str, list[KnowledgeBlock]] = defaultdict(list)
        self.vectors_by_conversation: dict[str, object] = {}
        self.bm25_by_conversation: dict[str, BM25Okapi] = {}

    @property
    def blocks(self) -> list[KnowledgeBlock]:
        return [block for blocks in self.blocks_by_conversation.values() for block in blocks]

    def add(self, blocks: list[KnowledgeBlock], conversation_id: str) -> None:
        scoped = []
        for block in blocks:
            block.metadata["conversation_id"] = conversation_id
            scoped.append(block)

        current = self.blocks_by_conversation[conversation_id]
        current.extend(scoped)
        texts = [block.text for block in current]
        self.vectors_by_conversation[conversation_id] = self.embedder.encode(
            texts, normalize_embeddings=True
        )
        self.bm25_by_conversation[conversation_id] = BM25Okapi(
            [text.lower().split() for text in texts]
        )

    def clear(self, conversation_id: str) -> None:
        self.blocks_by_conversation.pop(conversation_id, None)
        self.vectors_by_conversation.pop(conversation_id, None)
        self.bm25_by_conversation.pop(conversation_id, None)

    def search(self, query: str, conversation_id: str, top_k: int = 8) -> list[KnowledgeBlock]:
        blocks = self.blocks_by_conversation.get(conversation_id, [])
        vectors = self.vectors_by_conversation.get(conversation_id)
        bm25 = self.bm25_by_conversation.get(conversation_id)
        if not blocks or vectors is None or bm25 is None:
            return []

        query_vector = self.embedder.encode([query], normalize_embeddings=True)[0]
        dense = (vectors @ query_vector).argsort()[::-1][:20]
        sparse = bm25.get_scores(query.lower().split()).argsort()[::-1][:20]

        scores: dict[int, float] = {}
        for rank, index in enumerate(dense):
            scores[int(index)] = scores.get(int(index), 0) + 1 / (60 + rank + 1)
        for rank, index in enumerate(sparse):
            scores[int(index)] = scores.get(int(index), 0) + 1 / (60 + rank + 1)

        fused = sorted(scores, key=scores.get, reverse=True)[:20]
        pairs = [(query, blocks[index].text) for index in fused]
        try:
            self.reranker = self.reranker or CrossEncoder(settings.reranker_model)
            ranked = sorted(
                zip(fused, self.reranker.predict(pairs)),
                key=lambda item: item[1],
                reverse=True,
            )
            return [blocks[index] for index, _ in ranked[:top_k]]
        except Exception:
            return [blocks[index] for index in fused[:top_k]]


retriever = HybridRetriever()
