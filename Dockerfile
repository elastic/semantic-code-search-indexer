FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
RUN npm run build
RUN npm ci --only=production && npm cache clean --force


FROM node:22-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs indexer
WORKDIR /app

ENV GIT_AUTHOR_NAME=obltmachine
ENV GIT_AUTHOR_EMAIL=infra-root+obltmachine@elastic.co
ENV GIT_COMMITTER_NAME=obltmachine
ENV GIT_COMMITTER_EMAIL=infra-root+obltmachine@elastic.co

COPY --from=builder --chown=indexer:nodejs /app/dist ./dist
COPY --from=builder --chown=indexer:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=indexer:nodejs /app/package*.json ./
RUN chown -R indexer:nodejs .
USER indexer
RUN gh auth setup-git --hostname github.com --force

ENV NODE_ENV=production
# Configure OpenTelemetry via SCS_IDXR_OTEL_* environment variables

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node dist/index.js --help || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
