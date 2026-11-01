# Local OpenChat: Vite plus workerd, the same process as `pnpm dev`.
# It applies migrations to the container's local D1 only. It does not deploy.
# sandbox/Dockerfile is the optional code-execution image and is not used here.

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    WRANGLER_SEND_METRICS=false

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN sed -i 's/\r$//' docker/dev.sh && chmod +x docker/dev.sh

EXPOSE 5173

CMD ["./docker/dev.sh"]
