-- T1-05: Login Attempts — soft-lock tracking
-- Таблица хранит неудачные попытки входа для soft-lock по паре (normalizedEmail + ip).
-- Записи старше SOFT_LOCK_WINDOW_MS (15 мин) игнорируются логикой приложения.
-- Очистка устаревших записей выполняется scheduled job (T1-30).

CREATE TABLE "LoginAttempt" (
  "id"              TEXT         NOT NULL,
  "normalizedEmail" TEXT         NOT NULL,
  "ip"              TEXT         NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- Индекс покрывает запросы COUNT + findFirst по (email, ip, createdAt >= windowStart)
CREATE INDEX "LoginAttempt_normalizedEmail_ip_createdAt_idx"
  ON "LoginAttempt"("normalizedEmail", "ip", "createdAt");
