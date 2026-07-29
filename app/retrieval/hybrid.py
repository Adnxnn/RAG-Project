from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer, CrossEncoder
from app.core.models import KnowledgeBlock
from app.core.config import settings

class HybridRetriever:
    def __init__(self):
        self.blocks=[]; self.embedder=SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2"); self.reranker=None
        self.vectors=None; self.bm25=None
    def add(self, blocks:list[KnowledgeBlock]):
        self.blocks.extend(blocks)
        texts=[b.text for b in self.blocks]
        self.vectors=self.embedder.encode(texts,normalize_embeddings=True)
        self.bm25=BM25Okapi([t.lower().split() for t in texts])
    def search(self, query:str, top_k:int=8):
        if not self.blocks:return []
        qv=self.embedder.encode([query],normalize_embeddings=True)[0]
        dense=(self.vectors@qv).argsort()[::-1][:20]
        sparse=self.bm25.get_scores(query.lower().split()).argsort()[::-1][:20]
        scores={}
        for rank,idx in enumerate(dense): scores[int(idx)]=scores.get(int(idx),0)+1/(60+rank+1)
        for rank,idx in enumerate(sparse): scores[int(idx)]=scores.get(int(idx),0)+1/(60+rank+1)
        fused=sorted(scores,key=scores.get,reverse=True)[:20]
        pairs=[(query,self.blocks[i].text) for i in fused]
        try:
            self.reranker=self.reranker or CrossEncoder(settings.reranker_model)
            ranked=sorted(zip(fused,self.reranker.predict(pairs)),key=lambda x:x[1],reverse=True)
            return [self.blocks[i] for i,_ in ranked[:top_k]]
        except Exception:
            return [self.blocks[i] for i in fused[:top_k]]
retriever=HybridRetriever()
