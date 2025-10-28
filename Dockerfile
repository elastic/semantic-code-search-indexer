FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++ git
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm ci --only=production && npm cache clean --force


FROM node:22-alpine AS production

RUN apk add --no-cache git github-cli
RUN addgroup -g 1001 -S nodejs && \
    adduser -S indexer -u 1001 -G nodejs
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
# Configure OpenTelemetry via OTEL_* environment variables

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node dist/index.js --help || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
