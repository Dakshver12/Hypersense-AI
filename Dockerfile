FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HYPERSENSE_DATA_DIR=/var/lib/hypersense HF_HOME=/var/lib/hypersense/model-cache
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libgl1 libegl1 libgles2 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN groupadd --gid 10001 hypersense && useradd --uid 10001 --gid hypersense --create-home hypersense \
    && mkdir -p /var/lib/hypersense && chown hypersense:hypersense /var/lib/hypersense
COPY main.py ./
COPY backend ./backend
COPY templates ./templates
COPY static ./static
COPY face_landmarker.task ./
USER hypersense
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
