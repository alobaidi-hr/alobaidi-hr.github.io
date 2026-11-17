# L-O HR portal on the company server. Build context: the repository root.
#   docker build -f server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /src
RUN npm install --no-save --no-audit --no-fund esbuild@0.24.0
COPY netlify/functions/api.mjs netlify/functions/api.mjs
COPY data/seed.public.json data/migrations.json data/
COPY server/store.mjs server/store.mjs
RUN npx esbuild netlify/functions/api.mjs --bundle --platform=node --format=esm \
      --alias:@netlify/blobs=./server/store.mjs --outfile=out/api.bundle.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data/blobs SITE_DIR=/app/site
COPY --from=build /src/out/api.bundle.mjs ./api.bundle.mjs
COPY server/store.mjs server/main.mjs ./
COPY deploy/site/ ./site/
COPY erp/ ./site/erp/
RUN mkdir -p /data/blobs && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "main.mjs"]
