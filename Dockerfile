# syntax=docker/dockerfile:1

# ---- Build: install everything, build the web client and server bundle ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain only used if a native module has to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    CHROMIUM_PATH=/usr/bin/chromium
# chromium: PDF rendering · ffmpeg: video frames/posters/conversion · poppler-utils: images from imported PDFs
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg poppler-utils fonts-liberation fonts-noto-color-emoji ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/assets ./server/assets
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server/index.js"]
