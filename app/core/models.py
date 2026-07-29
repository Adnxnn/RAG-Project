from typing import Any, Literal
from pydantic import BaseModel, Field, HttpUrl


class SourceRef(BaseModel):
    source_id: str
    file_name: str
    locator: str
    url: str | None = None
    score: float | None = None


class KnowledgeBlock(BaseModel):
    id: str
    source_id: str
    kind: Literal["text", "table", "image", "code", "sheet", "web"]
    text: str
    raw: Any | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=20_000)
    workspace_id: str | None = None
    collection_id: str | None = None
    conversation_id: str | None = None
    urls: list[HttpUrl] = Field(default_factory=list)


class AnswerResponse(BaseModel):
    answer: str
    citations: list[SourceRef]
    route: str
    retries: int = 0
    conversation_id: str | None = None


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    workspace_id: str | None = None
    collection_id: str | None = None


class ConversationCreate(BaseModel):
    workspace_id: str
    title: str = Field(default="New conversation", max_length=200)


class HealthResponse(BaseModel):
    status: str
    database: str
    indexed_blocks: int
    version: str
