# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/src

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libpq-dev curl \
  && rm -rf /var/lib/apt/lists/*

# Shared contracts first, so a change to the service does not invalidate their layer.
COPY packages-py/nexus-agents-shared /tmp/nexus-agents-shared
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir /tmp/nexus-agents-shared

COPY apps/manager/pyproject.toml /app/pyproject.toml
RUN pip install --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic>=2.9" "pydantic-settings>=2.5" \
      "httpx>=0.27" "structlog>=24.4" "prometheus-client>=0.21" "redis>=5.1" "tenacity>=9.0" \
      "langgraph>=0.2.60" "langgraph-checkpoint-postgres>=2.0.2" "psycopg[binary,pool]>=3.2" \
      "instructor>=1.7" "jsonref>=1.1" "ollama>=0.4" "anthropic>=0.40" "openai>=1.51" "google-genai>=0.3" \
      "trafilatura>=1.12" "beautifulsoup4>=4.12" "youtube-transcript-api>=0.6.2" "yt-dlp>=2024.10.22" \
      "playwright>=1.48"

# The browser is only reached when static extraction reports a client-rendered page.
RUN playwright install --with-deps chromium

COPY apps/manager/src /app/src

EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:4100/healthz || exit 1
CMD ["uvicorn", "nexus_manager.main:app", "--host", "0.0.0.0", "--port", "4100"]
