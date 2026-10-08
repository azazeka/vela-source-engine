# ==============================================================================
# Multi-stage production Dockerfile for Vela Source Engine (tvOS Backend)
# ==============================================================================

# Stage 1: Build TypeScript artifacts
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# ==============================================================================
# Stage 2: Production runtime image
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    VELA_PROFILE_DIRECTORY=/app/data/profiles

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Writable profile directory; mount /app/data on persistent storage in production.
RUN mkdir -p /app/data/profiles && chown -R node:node /app/data

# Security hardening: Run as non-root unprivileged user
USER node

EXPOSE 3000

# Native health probe for container orchestrator (ACA, K8s, Docker)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start the Express orchestrator
CMD ["node", "dist/src/index.js"]
