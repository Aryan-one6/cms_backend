FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

# Runtime image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 5050
CMD ["node", "dist/server.js"]
