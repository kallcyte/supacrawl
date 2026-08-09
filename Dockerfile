FROM node:22-slim AS node-builder
WORKDIR /app

RUN apt-get update -qq && apt-get install -y -qq python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/

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
COPY packages/server/supacrawl.config.json packages/server/
COPY packages/server/src packages/server/src

COPY tsconfig.json ./

RUN pnpm --filter @supacrawl/core build && \
    pnpm --filter @supacrawl/dashboard build && \
    pnpm --filter @supacrawl/server build

FROM rust:1-slim AS rust-builder
WORKDIR /rust

RUN apt-get update -qq && apt-get install -y -qq musl-tools pkg-config libssl-dev && \
    rustup target add x86_64-unknown-linux-musl && \
    rm -rf /var/lib/apt/lists/*

COPY crawler/ ./

RUN cargo build --release --target x86_64-unknown-linux-musl && \
    strip target/x86_64-unknown-linux-musl/release/crawl-daemon

FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update -qq && apt-get install -y -qq python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=node-builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml /app/.npmrc ./

COPY --from=node-builder /app/packages/core/package.json /app/packages/core/
COPY --from=node-builder /app/packages/server/package.json /app/packages/server/

COPY --from=node-builder /app/packages/core/dist /app/packages/core/dist
COPY --from=node-builder /app/packages/server/dist /app/packages/server/dist
COPY --from=node-builder /app/packages/dashboard/dist /app/packages/dashboard/dist
COPY --from=node-builder /app/packages/server/supacrawl.config.json /app/packages/server/

COPY --from=rust-builder /rust/target/x86_64-unknown-linux-musl/release/crawl-daemon /usr/local/bin/crawl-daemon

RUN chmod +x /usr/local/bin/crawl-daemon

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm rebuild better-sqlite3

RUN mkdir -p /app/data

EXPOSE 3456 9090

ENV NODE_ENV=production
ENV PORT=3456
ENV HOST=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
ENV CRAWLER_DAEMON_BIN=/usr/local/bin/crawl-daemon

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3456/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(e => process.exit(1))"

CMD ["node", "packages/server/dist/index.js", "--config", "packages/server/supacrawl.config.json", "--db", "/app/data/supacrawl.db"]
