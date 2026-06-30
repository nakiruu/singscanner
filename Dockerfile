# syntax=docker/dockerfile:1.7
#
# Multi-stage build for Singularity Scanner.
#   - deps:    install ALL deps (including dev) for the build
#   - builder: prisma generate + next build (produces .next/standalone)
#   - runner:  minimal alpine image with only what's needed to run
#
# Build:    docker compose build
# Run:      docker compose up -d

############################
# Stage 1 — install deps
############################
FROM node:24-alpine AS deps
WORKDIR /app

# libc6-compat is required by sharp + some Next.js binaries on alpine
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
# npm ci is reproducible from the lockfile; --ignore-scripts skips Prisma's
# postinstall here so we can do it explicitly in the builder stage.
RUN npm ci --ignore-scripts


############################
# Stage 2 — build
############################
FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client against the schema, then build.
RUN npx prisma generate --no-hints
RUN npm run build


############################
# Stage 3 — runtime
############################
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl curl tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001 -G nodejs

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# Copy the standalone server, static assets, and public dir.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma needs the schema + generated engine at runtime for migrate deploy.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# Entrypoint runs migrations then starts the server.
COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/status >/dev/null || exit 1

# tini handles PID 1 signal forwarding so Ctrl-C / docker stop work cleanly.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
