# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps – install production dependencies only
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ── Build ─────────────────────────────────────────────────────────────────────
# Stage 2: build – compile TypeScript
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Production ────────────────────────────────────────────────────────────────
# Stage 3: prod – minimal runtime image
FROM node:20-bookworm-slim AS prod
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# IMPORTANT: The order of COPY is critical for Prisma. 
# We first copy standard node_modules (production only), 
# then OVERWRITE with the specifically generated Prisma Client from the build stage. 
# This prevents '@prisma/client did not initialize yet' errors.
COPY --from=deps  /app/node_modules                   ./node_modules
COPY --from=build /app/node_modules/.prisma           ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma           ./node_modules/@prisma

COPY --from=build /app/dist                           ./dist
COPY --from=build /app/prisma                         ./prisma
COPY package*.json ./

# Create uploads dir
RUN mkdir -p uploads

EXPOSE 3000

# Startup command
CMD ["node", "dist/src/main.js"]
