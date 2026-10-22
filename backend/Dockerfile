# Stage 1: Build & Dependencies
# Node 20, not 18: pdf-parse pulls in pdfjs-dist@5.x, which requires Node >= 20
# (process.getBuiltinModule, added in 20.16) - on Node 18 this crashed the whole
# process at boot, since meeting-logs.routes.js requires it eagerly via
# meetingNotes.service -> noteExtractor.service. Node 18 itself is also EOL
# (April 2025). Builder and runner must match so @napi-rs/canvas's native
# binary (another pdf-parse dependency) is built against the same Node ABI
# it actually runs under.
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Stage 2: Runtime Production Container
FROM node:20-alpine AS runner

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
