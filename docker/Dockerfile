# Omni backend — containerised gateway process.
#
# This runs the OpenClaw-compatible WebSocket gateway that Omni connects to.
# The Electron app itself runs on the host; this container provides the backend.
#
# Build:  docker build -f docker/Dockerfile -t omni-backend .
# Run:    docker compose up
#
# Runtime config is injected via environment variables (see docker-compose.yml).
# Mount omni.config.json and omni.persona.json as read-only volumes — they are
# never baked into the image.

FROM node:22-slim

WORKDIR /app

# Install bubblewrap for sandboxed shell tool execution
RUN apt-get update && apt-get install -y \
    bubblewrap \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

# Sandbox workspace — writable by the agent, isolated from the host
RUN mkdir -p /sandbox && chmod 700 /sandbox

COPY docker/bwrap-exec.sh /usr/local/bin/bwrap-exec
RUN chmod +x /usr/local/bin/bwrap-exec

ENV NODE_ENV=production
ENV SANDBOX_DIR=/sandbox

EXPOSE 18789

CMD ["node", "dist-electron/main.js"]
