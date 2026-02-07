FROM node:20-alpine

WORKDIR /app

# Install deps first for better caching
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

COPY . .

EXPOSE 8443

USER node

CMD ["node", "server.js"]
