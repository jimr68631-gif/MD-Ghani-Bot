FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg python3 python3-venv ca-certificates git build-essential pkg-config \
       libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade yt-dlp bgutil-ytdlp-pot-provider==2.0.0 \
    && git clone --single-branch --branch 2.0.0 --depth 1 \
       https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm ci --no-audit --no-fund \
    && npx tsc \
    && npm prune --omit=dev --no-audit --no-fund \
    && rm -rf /var/lib/apt/lists/*

ENV YOUTUBE_POT_PROVIDER_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p sessions

EXPOSE 3000

CMD ["node", "index.js"]
