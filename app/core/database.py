from __future__ import annotations

from typing import Any
from supabase import Client, create_client

from app.core.config import settings


class Database:
    def __init__(self) -> None:
        self._client: Client | None = None

    @property
    def enabled(self) -> bool:
        return bool(settings.supabase_url and settings.supabase_service_role_key)

    @property
    def client(self) -> Client:
        if not self.enabled:
            raise RuntimeError("Supabase is not configured")
        if self._client is None:
            self._client = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key,
            )
        return self._client

    def create_document(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.client.table("documents").insert(payload).execute().data[0]

    def update_document(self, document_id: str, payload: dict[str, Any]) -> None:
        self.client.table("documents").update(payload).eq("id", document_id).execute()

    def insert_chunks(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self.client.table("document_chunks").insert(rows).execute()

    def create_conversation(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.client.table("conversations").insert(payload).execute().data[0]

    def add_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.client.table("messages").insert(payload).execute().data[0]

    def list_messages(self, conversation_id: str, limit: int = 30) -> list[dict[str, Any]]:
        return (
            self.client.table("messages")
            .select("*")
            .eq("conversation_id", conversation_id)
            .order("created_at")
            .limit(limit)
            .execute()
            .data
        )

    def match_chunks(
        self,
        *,
        embedding: list[float],
        workspace_id: str,
        collection_id: str | None,
        count: int,
    ) -> list[dict[str, Any]]:
        return self.client.rpc(
            "match_document_chunks",
            {
                "query_embedding": embedding,
                "match_workspace_id": workspace_id,
                "match_collection_id": collection_id,
                "match_count": count,
                "similarity_threshold": settings.similarity_threshold,
            },
        ).execute().data


database = Database()
