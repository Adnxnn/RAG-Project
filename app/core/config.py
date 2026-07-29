from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_vision_model: str = "gpt-4o-mini"
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "corporate_knowledge"
    reranker_model: str = "BAAI/bge-reranker-base"
    web_allowed_domains: str = ""
    max_corrective_retries: int = 2
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
