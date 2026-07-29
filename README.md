# Corporate Multimodal Knowledge Graph & Corrective RAG

Production-oriented starter for an all-in-one RAG agent with multimodal ingestion, hybrid dense + BM25 retrieval, Reciprocal Rank Fusion, cross-encoder reranking, LangGraph routing, corrective retry, source citations, evaluation dependencies, and observability hooks.

## Reads
PDFs (including scanned pages and embedded images), Excel workbooks, CSV, Word tables, standalone images, text/code files, and approved reference URLs. Metadata is preserved as page, sheet, cell range, table, image, paragraph, or URL provenance.

## Run
```bash
cp .env.example .env
# Set OPENAI_API_KEY
docker compose up --build
```
UI: http://localhost:8501  
API: http://localhost:8000/docs

## Current production foundation
- Layout-aware extraction through PyMuPDF and Unstructured
- Vision extraction for charts, diagrams, screenshots, scanned content and embedded PDF images
- Sheet-aware Excel ingestion and tabular raw-data retention
- URL ingestion with allow-listing and basic SSRF protection
- Dense + BM25 retrieval merged using RRF
- Optional BGE cross-encoder reranking
- Corrective query rewrite loop in LangGraph
- Grounded answers with source locations
- Dockerized FastAPI, Streamlit and Qdrant services
- RAGAS and Phoenix/OpenTelemetry dependencies ready for expanded evaluation and tracing

## Important next production controls
Enterprise SSO/RBAC, ACL-aware chunk filtering, persistent BM25 and vector indexes, malware scanning, PII redaction, signed source URLs, SQL read-only allow-lists, crawl depth controls, document versioning, and a curated evaluation dataset.
