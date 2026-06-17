# ==========================================
# Stage 1: Build the React Frontend Dashboard
# ==========================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

# Install dependencies first (for docker caching)
COPY frontend/package*.json ./
RUN npm install

# Copy source and build static bundle
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Build the Final Production Container
# ==========================================
FROM node:22-slim
WORKDIR /app/backend

# Install production dependencies only
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copy backend source code
COPY backend/src/ ./src/

# Copy compiled static frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./public

# Environment variables configuration defaults
ENV NODE_ENV=production
ENV DNS_PORT=53
ENV API_PORT=8080
ENV DB_DIR=/app/data
ENV FRONTEND_PATH=/app/backend/public

# Persistent volume mapping for SQLite database and query logs
VOLUME ["/app/data"]

# DNS server UDP port + Web UI TCP port
EXPOSE 53/udp
EXPOSE 8080/tcp

CMD ["node", "src/index.js"]
