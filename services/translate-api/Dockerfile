FROM node:20-slim AS base

# Install Python + pip for the translation worker
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package.json ./
RUN npm install --production

# Install Python dependencies
RUN pip3 install --break-system-packages ctranslate2 sentencepiece

# Copy application code
COPY server.js translate-worker.py download-model.py ./

# Model directory (mount as volume or build with model baked in)
VOLUME /app/models

# Environment
ENV PORT=8099
ENV MODEL_PATH=/app/models/nllb-200-600M
ENV NODE_ENV=production

EXPOSE 8099

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
    CMD curl -f http://localhost:8099/health || exit 1

CMD ["node", "server.js"]
