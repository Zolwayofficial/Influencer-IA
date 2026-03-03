FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

RUN mkdir -p /app/data

ENV PYTHONUNBUFFERED=1
# Cache de sentence-transformers (all-MiniLM-L6-v2 ~90MB)
ENV HF_HOME=/app/data/hf_cache
ENV TOKENIZERS_PARALLELISM=false

EXPOSE 6789

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "6789"]
