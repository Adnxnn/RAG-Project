from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.agents.graph import agent_graph
from app.core.config import settings
from app.core.database import database
from app.core.models import (
    AnswerResponse,
    ConversationCreate,
    HealthResponse,
    QueryRequest,
    UrlIngestRequest,
)
from app.ingestion.loaders import load_file
from app.ingestion.web import load_url
from app.retrieval.hybrid import retriever

app = FastAPI(
    title="Corporate Multimodal RAG",
    version="1.0.0",
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url="/redoc" if settings.environment != "production" else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOADS = Path("data/uploads")
UPLOADS.mkdir(parents=True, exist_ok=True)


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        database="connected" if database.enabled else "not_configured",
        indexed_blocks=len(retriever.blocks),
        version="1.0.0",
    )


@app.post("/conversations", dependencies=[Depends(require_api_key)])
def create_conversation(req: ConversationCreate):
    if not database.enabled:
        raise HTTPException(503, "Supabase is not configured")
    return database.create_conversation(
        {"workspace_id": req.workspace_id, "title": req.title}
    )


@app.post("/ingest/files", dependencies=[Depends(require_api_key)])
async def ingest_files(
    files: list[UploadFile] = File(...),
    workspace_id: str | None = None,
    collection_id: str | None = None,
):
    total = 0
    details = []
    max_bytes = settings.max_upload_mb * 1024 * 1024

    for upload in files:
        content = await upload.read()
        if len(content) > max_bytes:
            raise HTTPException(413, f"{upload.filename} exceeds {settings.max_upload_mb} MB")

        safe_name = Path(upload.filename or "upload").name
        path = UPLOADS / f"{uuid4()}-{safe_name}"
        path.write_bytes(content)
        blocks = load_file(path)
        retriever.add(blocks)
        total += len(blocks)

        document_id = None
        if database.enabled and workspace_id:
            checksum = hashlib.sha256(content).hexdigest()
            document = database.create_document(
                {
                    "workspace_id": workspace_id,
                    "collection_id": collection_id,
                    "name": safe_name,
                    "source_type": "file",
                    "mime_type": upload.content_type,
                    "size_bytes": len(content),
                    "checksum": checksum,
                    "status": "processing",
                }
            )
            document_id = document["id"]
            rows = []
            for index, block in enumerate(blocks):
                rows.append(
                    {
                        "document_id": document_id,
                        "workspace_id": workspace_id,
                        "collection_id": collection_id,
                        "chunk_index": index,
                        "kind": block.kind,
                        "content": block.text,
                        "locator": str(block.metadata.get("locator", index)),
                        "metadata": block.metadata,
                    }
                )
            database.insert_chunks(rows)
            database.update_document(document_id, {"status": "ready"})

        details.append({"file": safe_name, "blocks": len(blocks), "document_id": document_id})

    return {"ingested_blocks": total, "files": details}


@app.post("/ingest/url", dependencies=[Depends(require_api_key)])
async def ingest_url(req: UrlIngestRequest):
    try:
        blocks = await load_url(str(req.url))
        retriever.add(blocks)
        return {"url": str(req.url), "blocks": len(blocks)}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/chat", response_model=AnswerResponse, dependencies=[Depends(require_api_key)])
async def chat(req: QueryRequest) -> AnswerResponse:
    for url in req.urls:
        retriever.add(await load_url(str(url)))

    conversation_id = req.conversation_id
    if database.enabled and req.workspace_id:
        if not conversation_id:
            conversation = database.create_conversation(
                {"workspace_id": req.workspace_id, "title": req.question[:80]}
            )
            conversation_id = conversation["id"]
        database.add_message(
            {
                "conversation_id": conversation_id,
                "workspace_id": req.workspace_id,
                "role": "user",
                "content": req.question,
            }
        )

    result = agent_graph.invoke({"question": req.question})
    response = AnswerResponse(
        answer=result["answer"],
        citations=result["citations"],
        route=result["route"],
        retries=result["retries"],
        conversation_id=conversation_id,
    )

    if database.enabled and req.workspace_id and conversation_id:
        database.add_message(
            {
                "conversation_id": conversation_id,
                "workspace_id": req.workspace_id,
                "role": "assistant",
                "content": response.answer,
                "citations": [citation.model_dump() for citation in response.citations],
                "metadata": {"route": response.route, "retries": response.retries},
            }
        )

    return response
