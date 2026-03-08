FROM python:3.11-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Copy project files (context is repo root)
COPY packages/runtime/pyproject.toml packages/runtime/uv.lock ./

# Install dependencies
RUN uv sync --no-dev --no-install-project

# Copy source
COPY packages/runtime/src/ src/

# Install the project itself
RUN uv sync --no-dev

# Create data directory for parquet cache
RUN mkdir -p /app/data

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "aegis_runtime.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
