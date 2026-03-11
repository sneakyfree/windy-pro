FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY server.js r2-adapter.js ./

EXPOSE 8100

CMD ["node", "server.js"]
