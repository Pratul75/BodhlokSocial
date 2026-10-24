# syntax=docker/dockerfile:1.7
# Every workspace package's package.json must be listed in both install steps below,
# or its dependencies are not installed.
#
# One Dockerfile, two images:
#   docker build --target web    -t bodh-web .
#   docker build --target worker -t bodh-worker .
# The worker image also runs database migrations as a Cloud Run job.

FROM node:24-slim AS base
ENV COREPACK_HOME=/corepack
RUN corepack enable && mkdir -p /corepack && chmod 755 /corepack
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/guardrails/package.json packages/guardrails/
COPY packages/integrations/package.json packages/integrations/
COPY packages/agents/package.json packages/agents/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS web-build
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @bodh/web build

FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 TZ=Asia/Kolkata
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]

FROM base AS worker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/guardrails/package.json packages/guardrails/
COPY packages/integrations/package.json packages/integrations/
COPY packages/agents/package.json packages/agents/
# Only the worker and database packages and their dependencies, not the web app's.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@bodh/worker..." --filter "@bodh/db..."
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker
ENV NODE_ENV=production PORT=8080 TZ=Asia/Kolkata
RUN chown -R node:node /repo
USER node
EXPOSE 8080
# Migrations: override the command with
#   packages/db/node_modules/.bin/tsx packages/db/src/migrate.ts
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]
