FROM oven/bun:1-alpine AS base

# Install ping and traceroute utilities
RUN apk add --no-cache iputils-ping busybox-extras

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/collector/package.json apps/collector/

# Install dependencies
RUN bun install

# Copy source
COPY packages/shared packages/shared
COPY apps/collector apps/collector

# Create data directory
RUN mkdir -p /app/data

WORKDIR /app/apps/collector

ENV DATABASE_PATH=/app/data/isp-observability.db
ENV PORT=4000

EXPOSE 4000

CMD ["bun", "run", "src/index.ts"]
