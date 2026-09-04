from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")

    # Where agent targets are executed.
    orchestrator_url: str = Field(default="http://localhost:4000", alias="ORCHESTRATOR_URL")

    embedding_model: str = Field(default="text-embedding-3-small", alias="EMBEDDING_MODEL")
    judge_model: str = Field(default="gemini-1.5-pro", alias="JUDGE_MODEL")

    # How many cases run concurrently within a single eval run.
    eval_concurrency: int = Field(default=4, ge=1, le=32, alias="EVAL_CONCURRENCY")
    # Ceiling on how long we wait for one agent run to reach a terminal state.
    agent_run_timeout_s: float = Field(default=300.0, gt=0, alias="AGENT_RUN_TIMEOUT_S")

    evals_port: int = Field(default=5100, alias="EVALS_PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")


settings = Settings()
