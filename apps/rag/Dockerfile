# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
  && rm -rf /var/lib/apt/lists/*

COPY apps/rag/pyproject.toml .
RUN pip install --upgrade pip \
  && pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic>=2.9" "pydantic-settings>=2.5" \
      "httpx>=0.27" "asyncpg>=0.29" "psycopg[binary]>=3.2" "sqlalchemy[asyncio]>=2.0" "pgvector>=0.3" \
      "tiktoken>=0.8" "google-generativeai>=0.8.2" "prometheus-client>=0.21" "structlog>=24.4" "numpy>=2.1" "rank-bm25>=0.2.2"

COPY apps/rag/app ./app
EXPOSE 5000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
