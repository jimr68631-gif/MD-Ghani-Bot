FROM node:20-bullseye

RUN apt-get update && apt-get install -y \
    ffmpeg imagemagick webp git python3 build-essential \
    chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --production=false

COPY . .

RUN mkdir -p sessions

EXPOSE 3000

CMD ["node", "index.js"]