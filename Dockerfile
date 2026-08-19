FROM node:22-slim AS node-builder
WORKDIR /app

RUN apt-get update -qq && apt-get install -y -qq python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild better-sqlite3 esbuild

COPY packages/core/tsconfig.json packages/core/tsconfig.json
COPY packages/core/tsup.config.ts packages/core/tsup.config.ts
COPY packages/core/src packages/core/src

COPY packages/dashboard/tsconfig.json packages/dashboard/tsconfig.json
COPY packages/dashboard/vite.config.ts packages/dashboard/vite.config.ts
COPY packages/dashboard/index.html packages/dashboard/
COPY packages/dashboard/public packages/dashboard/public
COPY packages/dashboard/src packages/dashboard/src

COPY packages/server/tsconfig.json packages/server/tsconfig.json
COPY packages/server/tsup.config.ts packages/server/tsup.config.ts
# The per-deployment config is gitignored, so bake the committed example into
# the image. Production overrides it with a volume mount (see docker-compose).
COPY supacrawl.config.example.json packages/server/supacrawl.config.json
COPY packages/server/src packages/server/src

COPY tsconfig.json ./

# Bound Node's heap so the build fits in the host's small RAM. Without this, V8
# free-runs and gets kernel-OOM-killed (exit 137). 1536 is balanced for a ~2GB
# host + swap: too low causes V8 heap OOM, too high trips the kernel OOM killer.
ENV NODE_OPTIONS=--max-old-space-size=1536

RUN pnpm --filter @supacrawl/core build && \
    pnpm --filter @supacrawl/dashboard build && \
    pnpm --filter @supacrawl/server build


# trixie (glibc 2.39) is required: better-sqlite3's arm64 prebuilt links
# GLIBC 2.38, unavailable on the default bookworm base (2.36).
FROM node:22-trixie-slim AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=node-builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml /app/.npmrc ./

COPY --from=node-builder /app/packages/core/package.json /app/packages/core/
COPY --from=node-builder /app/packages/server/package.json /app/packages/server/

COPY --from=node-builder /app/packages/core/dist /app/packages/core/dist
COPY --from=node-builder /app/packages/server/dist /app/packages/server/dist
COPY --from=node-builder /app/packages/dashboard/dist /app/packages/dashboard/dist
COPY --from=node-builder /app/packages/server/supacrawl.config.json /app/packages/server/


RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

RUN mkdir -p /app/data

EXPOSE 3456 9090

ENV NODE_ENV=production
ENV PORT=3456
ENV HOST=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=512 --expose-gc"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3456/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(e => process.exit(1))"

CMD ["node", "packages/server/dist/index.js", "--config", "packages/server/supacrawl.config.json", "--db", "/app/data/supacrawl.db"]
