FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd /app/backend && npm ci --only=production
COPY backend/ ./backend/
COPY frontend/ ./frontend/
EXPOSE 3000
CMD ["node", "/app/backend/src/server.js"]
