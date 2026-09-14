FROM node:20-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg imagemagick webp git python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p sessions

EXPOSE 3000

CMD ["node", "index.js"]

# Railway automatically provides PORT; the app reads process.env.PORT
