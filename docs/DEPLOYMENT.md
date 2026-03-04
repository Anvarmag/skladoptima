# Деплой и Инфраструктура — Sklad Optima

> **Инструмент:** Docker Compose  
> **Файл:** `docker-compose.yml` (в корне монорепо)

---

## Архитектура контейнеров

Приложение бьётся на 3 изолированных сервиса в единой Docker-сети `sklad-network`:

| Сервис | Образ | Внутренний | Внешний | Volumes | Healthcheck |
|--------|-------|------------|---------|---------|-------------|
| `postgres` | `postgres:15-alpine` | `5432` | — | `postgres_data` | `pg_isready` |
| `api` | custom (`node:20-slim`) | `3000` | `3000` (opt.) | `uploads_data` | `wget /api/health` |
| `web` | custom (`nginx:alpine`) | `80` | `80`, `443` | — | `curl localhost` |

> ВАЖНО: Node 20 запущен на Debian-based `slim` вместо `alpine`, так как Prisma ORM (и OpenSSL) конфликтует под мускальной либой alpine.

---

## `docker-compose.yml`

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy # Ждёт пока БД не ответит pg_isready
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
      - JWT_SECRET=${JWT_SECRET}
      - PORT=3000
      - CORS_ORIGIN=${CORS_ORIGIN}
    volumes:
      - uploads_data:/app/apps/api/uploads
    ports:
      - "3000:3000"

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy # Ждёт запуска NestJS (порт 3000)
    ports:
      - "80:80"

volumes:
  postgres_data:
  uploads_data:

networks:
  sklad-network:
```

---

## Деплой на VPS

### 1. Подготовка сервера

```bash
sudo apt update
sudo apt install docker.io docker-compose git
```

### 2. Клонирование репозитория

```bash
cd /opt
git clone https://github.com/skladoptima/skladoptima.git
cd skladoptima
```

### 3. Настройка `.env` файла

Создайте файл `.env` в корне проекта на основе `.env.example`:

```env
# База данных
POSTGRES_USER=myuser
POSTGRES_PASSWORD=securepassword
POSTGRES_DB=skladoptima

# Приложение
JWT_SECRET=generate_strong_random_string_here
PORT=3000
CORS_ORIGIN=http://yourdomain.com

# URL для Фронтенда (во время build-этапа Docker)
VITE_API_URL=/api
```

> **Важно `VITE_API_URL`**: В Prod среде Vite компилируется с относительным адресом `/api`, так как запросы идут через локальный Nginx (в контейнере `web`), который проксирует пути `/api` и `/uploads` в контейнер `api:3000`.

### 4. Запуск

```bash
docker-compose --env-file .env up -d --build
```

### 5. Миграции базы данных

При первом запуске нужно накатить структуру Prisma и пользователя `admin`:

```bash
# Ищем ID или Имя контейнера api
docker ps | grep api

# Заходим внутрь (или сразу выполняем команду)
docker exec -it <api_container_name> bash
cd apps/api
npx prisma migrate deploy  # SQL миграции
npx ts-node prisma/seed.ts # Создание админа
exit
```

---

## Структура Dockerfile'ов

**`apps/api/Dockerfile`:**
- Multi-stage: `builder` -> `production`.
- `npm run build --workspace=apps/api`.
- В Prod стейдж копируется `dist`, `node_modules`, `prisma`.
- `CMD ["npm", "run", "start:prod", "--workspace=apps/api"]`.

**`apps/web/Dockerfile`:**
- Multi-stage: `builder` -> `production`.
- `npm run build --workspace=apps/web`.
- В Prod стейдж перекидывается папка `dist` в `/usr/share/nginx/html`.
- Заменяется стандартный `nginx.conf` на наш:
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA-маршрутизация
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://api:3000/; # Убираем /api префикс или передаем, зависит от main.ts (у нас префикс глобальный)
        # Обратите внимание: зависит от того, как настроен NestJS. У нас app.setGlobalPrefix('api')
        proxy_pass http://api:3000/api/; 
    }

    # Uploads Proxy
    location /uploads/ {
        proxy_pass http://api:3000/uploads/;
    }
}
```
*(Точный `nginx.conf` лежит в папке `apps/web/nginx.conf`)*
