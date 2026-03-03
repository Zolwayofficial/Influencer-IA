FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# torch CPU-only (mucho mas ligero que CUDA)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

RUN mkdir -p /app/backgrounds /app/models

ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/app/models
# Usar hilos de CPU para inference
ENV OMP_NUM_THREADS=4

EXPOSE 7860

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
