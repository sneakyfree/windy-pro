FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy server code
COPY server.js ./

# Create data directories
RUN mkdir -p /data /data/media

# Environment defaults
ENV PORT=8098
ENV DATABASE_PATH=/data/accounts.db
ENV MEDIA_PATH=/data/media

EXPOSE 8098

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:8098/health || exit 1

CMD ["node", "server.js"]
