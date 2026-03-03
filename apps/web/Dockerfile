# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: build React app
# Stage 2: serve via nginx
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# VITE_API_URL is baked into the static bundle at build time
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Serve ─────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS prod

COPY --from=build /app/dist /usr/share/nginx/html

# nginx config: SPA fallback + proxy /api to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
