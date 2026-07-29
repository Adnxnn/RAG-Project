from typing import Any, Literal
from pydantic import BaseModel, Field

class SourceRef(BaseModel):
    source_id: str
    file_name: str
    locator: str
    url: str | None = None

class KnowledgeBlock(BaseModel):
    id: str
    source_id: str
    kind: Literal["text", "table", "image", "code", "sheet", "web"]
    text: str
    raw: Any | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

class QueryRequest(BaseModel):
    question: str
    conversation_id: str | None = None
    urls: list[str] = Field(default_factory=list)

class AnswerResponse(BaseModel):
    answer: str
    citations: list[SourceRef]
    route: str
    retries: int = 0
