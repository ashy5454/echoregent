FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build frontend (Vite → dist/)
RUN npm run build

# Expose port (Cloud Run injects PORT env var)
EXPOSE 8787

# Start server via tsx (TypeScript runtime)
CMD ["npx", "tsx", "src/server.ts"]
