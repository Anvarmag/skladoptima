# TODO

## 🔒 Когда настроишь HTTPS (Caddy/Nginx + SSL)

1. Добавить в `.env` на сервере:
   ```
   FORCE_HTTPS=true
   ```
   Это включит `secure` флаг на cookie — безопаснее для авторизации.

2. Добавить `CORS_ORIGIN` если нужно ограничить домены:
   ```
   CORS_ORIGIN=https://sklad.твой-домен.ru
   ```

3. В Telegram BotFather → Menu Button → указать `https://sklad.твой-домен.ru/app`

4. Добавить `TELEGRAM_BOT_TOKEN` в `.env` на сервере

5. Перезапустить: `docker compose restart api`

## 📋 Будущие улучшения

- [ ] Настроить CI/CD: GitHub → автодеплой на VPS
- [ ] Добавить бэкапы PostgreSQL (cron + pg_dump)
- [ ] Мониторинг (uptime, логи)
