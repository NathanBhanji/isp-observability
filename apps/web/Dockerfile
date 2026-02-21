FROM oven/bun:1-alpine AS deps

WORKDIR /app

# Copy workspace root files for dependency resolution
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

# Install all dependencies using Bun (resolves workspace:* protocol)
RUN bun install

# Copy source
COPY packages/shared packages/shared
COPY apps/web apps/web

# ── Build with Node.js (Next.js requires Node runtime) ──────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy everything from deps stage (includes node_modules)
COPY --from=deps /app ./

WORKDIR /app/apps/web
RUN npx next build

# ── Production image ─────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy the standalone output (includes server.js + node_modules trace)
COPY --from=builder /app/apps/web/.next/standalone ./

# Copy static assets that standalone doesn't include
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
