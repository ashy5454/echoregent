# EchoRegent - Multi-Cloud & Local Container Try-Out Image
# Optimized for Node.js 22 on Alpine Linux
# Provides loopback proxy isolation with transparent container ingress forwarding

FROM node:22-alpine

# Install socat for transparent 0.0.0.0 external ingress bridge to IPv4 loopback
RUN apk add --no-cache socat

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/

# Install dependencies
RUN npm ci

# Copy repository source code
COPY . .

# Build packages (@arkadhi/echoregent-core and @arkadhi/echoregent) and link CLI globally
RUN npm run build:packages && npm link ./packages/cli

# Create persistent storage volume for continual LLM-wiki memory and adaptive models
RUN mkdir -p /data/.echoregent/memory && chmod 777 /data/.echoregent/memory
VOLUME ["/data/.echoregent/memory"]

# Default environment configuration
ENV NODE_ENV=production \
    PORT=8787 \
    INTERNAL_PORT=8788 \
    BIND_ADDRESS=0.0.0.0 \
    ECHOREGENT_UPSTREAM=https://api.openai.com/v1 \
    ENABLE_FILE_MEMORY=true \
    MEMORY_DIR=/data/.echoregent/memory \
    RETENTION_DAYS=14 \
    PROJECT_NAME=default \
    SESSION_NAME=default

EXPOSE 8787

# Generate internal container entrypoint
# Note: EchoRegent proxy binds strictly to 127.0.0.1 for local isolation.
# - When BIND_ADDRESS=0.0.0.0 (Cloud Run, Fly.io, Render, Docker): socat transparently bridges
#   external container traffic (0.0.0.0:$PORT) to local loopback (127.0.0.1:$INTERNAL_PORT).
# - When BIND_ADDRESS=127.0.0.1 (sidecar, devcontainer): proxy binds directly to 127.0.0.1:$PORT.
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'PORT="${PORT:-8787}"' \
  'INTERNAL_PORT="${INTERNAL_PORT:-8788}"' \
  'BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"' \
  'MEMORY_DIR="${MEMORY_DIR:-/data/.echoregent/memory}"' \
  'RETENTION_DAYS="${RETENTION_DAYS:-14}"' \
  'PROJECT_NAME="${PROJECT_NAME:-default}"' \
  'SESSION_NAME="${SESSION_NAME:-default}"' \
  'ENABLE_FILE_MEMORY="${ENABLE_FILE_MEMORY:-true}"' \
  '' \
  'if [ "$BIND_ADDRESS" = "0.0.0.0" ]; then' \
  '  TARGET_PORT="$INTERNAL_PORT"' \
  '  echo "[EchoRegent] Starting external ingress bridge: 0.0.0.0:$PORT -> 127.0.0.1:$TARGET_PORT"' \
  '  socat TCP-LISTEN:"$PORT",fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:"$TARGET_PORT" &' \
  'else' \
  '  TARGET_PORT="$PORT"' \
  'fi' \
  '' \
  'ARGS="--port $TARGET_PORT --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory"' \
  'if [ "$ENABLE_FILE_MEMORY" = "true" ]; then' \
  '  ARGS="$ARGS --memory file --memory-dir $MEMORY_DIR --retention-days $RETENTION_DAYS --project $PROJECT_NAME --session $SESSION_NAME"' \
  'fi' \
  'if [ -n "$ECHOREGENT_LOCAL_TOKEN" ]; then' \
  '  ARGS="$ARGS --local-token $ECHOREGENT_LOCAL_TOKEN"' \
  'fi' \
  '' \
  'echo "[EchoRegent] Launching proxy server on loopback port $TARGET_PORT (Upstream: ${ECHOREGENT_UPSTREAM:-https://api.openai.com/v1})..."' \
  'exec node packages/cli/dist/index.js proxy $ARGS "$@"' \
  > /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
