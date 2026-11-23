FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg qbittorrent-nox tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.10.11 "yt-dlp[default]==2026.10.26" deno==2.9.8
# Tailscale (userspace networking) for the public HTTPS address of the web app (Funnel)
ARG BUILD_ARCH=amd64
RUN ARCH=$([ "$BUILD_ARCH" = "aarch64" ] && echo arm64 || echo amd64) && python -c "import urllib.request,tarfile,io,sys; d=urllib.request.urlopen('https://pkgs.tailscale.com/stable/tailscale_1.104.5_'+sys.argv[1]+'.tgz').read(); t=tarfile.open(fileobj=io.BytesIO(d)); [open('/usr/local/bin/'+m.name.split('/')[-1],'wb').write(t.extractfile(m).read()) for m in t.getmembers() if m.name.split('/')[-1] in ('tailscale','tailscaled')]" $ARCH && chmod +x /usr/local/bin/tailscale /usr/local/bin/tailscaled
COPY app ./app
COPY launcher.py /launcher.py
COPY remote.py /remote.py
ENV PYTHONUNBUFFERED=1 DATA_DIR=/data PORT=8090 PUBLIC_PORT=8091 TZ=Europe/Bucharest
CMD ["python", "/launcher.py"]
