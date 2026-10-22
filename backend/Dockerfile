# Stage 1: Build & Dependencies
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Stage 2: Runtime Production Container
FROM node:18-alpine AS runner

# curl is required by docker-compose.yml's healthcheck (CMD-SHELL curl ... /health) -
# the node:alpine base image does not ship it by default, which was causing the
# healthcheck command itself to fail regardless of app state.
RUN apk add --no-cache curl

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/src ./src

EXPOSE 5000

CMD ["node", "src/server.js"]
