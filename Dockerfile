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

RUN apk add --no-cache git
RUN addgroup -g 1001 -S nodejs && \
    adduser -S indexer -u 1001 -G nodejs
WORKDIR /app

COPY --from=builder --chown=indexer:nodejs /app/dist ./dist
COPY --from=builder --chown=indexer:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=indexer:nodejs /app/package*.json ./
RUN chown -R indexer:nodejs .
USER indexer

ENV NODE_ENV=production
ENV LOG_FORMAT=json

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node dist/index.js --help || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
