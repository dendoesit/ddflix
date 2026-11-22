FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg qbittorrent-nox tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.10.11 "yt-dlp[default]==2026.10.26" deno==2.9.8
COPY app ./app
COPY launcher.py /launcher.py
ENV PYTHONUNBUFFERED=1 DATA_DIR=/data PORT=8090 PUBLIC_PORT=8091 TZ=Europe/Bucharest
CMD ["python", "/launcher.py"]
