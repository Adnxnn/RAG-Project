from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    cors_origins: str = "http://localhost:3000"
    api_key: str = ""

    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_vision_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "corporate_knowledge"
    reranker_model: str = "BAAI/bge-reranker-base"
    web_allowed_domains: str = ""
    max_corrective_retries: int = 2
    retrieval_top_k: int = 8
    similarity_threshold: float = 0.2
    max_upload_mb: int = 25

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
