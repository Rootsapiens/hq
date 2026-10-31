# One container: builds the web app, then the Node server serves it plus the API and WebSocket.
FROM node:22-bookworm-slim
WORKDIR /app
# build tools for better-sqlite3 in case no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY shared/package.json shared/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production \
    HQ_HOST=0.0.0.0 \
    HQ_STATIC_DIR=/app/web/dist \
    HQ_DB=/data/hq.sqlite
EXPOSE 8787
CMD ["npx", "tsx", "server/src/index.ts"]
