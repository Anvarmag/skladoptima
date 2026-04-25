-- T1-01: Auth Data Model
-- Добавляет серверные сессии, challenge-токены, user preferences и auth identities.
-- Переименовывает User.password → User.passwordHash.
-- Мигрирует существующих пользователей в статус ACTIVE.

-- 1. Новые enum-типы
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'LOCKED', 'DELETED');
CREATE TYPE "AuthSessionStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED', 'COMPROMISED');
CREATE TYPE "ChallengeStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'TELEGRAM', 'GOOGLE', 'YANDEX', 'SMS');

-- 2. Расширяем таблицу User
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";

ALTER TABLE "User"
  ADD COLUMN "phone"           VARCHAR(32)  UNIQUE,
  ADD COLUMN "status"          "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ,
  ADD COLUMN "lastLoginAt"     TIMESTAMPTZ;

-- Существующие MVP-пользователи уже работали — переводим их в ACTIVE
UPDATE "User"
SET
  "status"          = 'ACTIVE',
  "emailVerifiedAt" = "createdAt"
WHERE "status" = 'PENDING_VERIFICATION';

-- 3. AuthSession — серверные сессии с refresh token rotation
CREATE TABLE "AuthSession" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID         NOT NULL,
  "refreshTokenHash" TEXT         NOT NULL,
  "status"           "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "ip"               TEXT,
  "userAgent"        TEXT,
  "lastSeenAt"       TIMESTAMPTZ,
  "expiresAt"        TIMESTAMPTZ  NOT NULL,
  "revokedAt"        TIMESTAMPTZ,
  "revokeReason"     VARCHAR(64),
  "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSession_refreshTokenHash_key" UNIQUE ("refreshTokenHash"),
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "AuthSession_userId_status_idx" ON "AuthSession"("userId", "status");

-- 4. EmailVerificationChallenge — одноразовые токены подтверждения email
CREATE TABLE "EmailVerificationChallenge" (
  "id"            UUID            NOT NULL DEFAULT gen_random_uuid(),
  "userId"        UUID            NOT NULL,
  "emailSnapshot" TEXT            NOT NULL,
  "tokenHash"     TEXT            NOT NULL,
  "status"        "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt"     TIMESTAMPTZ     NOT NULL,
  "usedAt"        TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT "EmailVerificationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailVerificationChallenge_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "EmailVerificationChallenge_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "EmailVerificationChallenge_userId_idx" ON "EmailVerificationChallenge"("userId");

-- 5. PasswordResetChallenge — одноразовые токены сброса пароля
CREATE TABLE "PasswordResetChallenge" (
  "id"        UUID            NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID            NOT NULL,
  "tokenHash" TEXT            NOT NULL,
  "status"    "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ     NOT NULL,
  "usedAt"    TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT "PasswordResetChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetChallenge_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "PasswordResetChallenge_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "PasswordResetChallenge_userId_idx" ON "PasswordResetChallenge"("userId");

-- 6. UserPreference — настройки пользователя (lastUsedTenantId и др.)
CREATE TABLE "UserPreference" (
  "userId"           UUID  NOT NULL,
  "lastUsedTenantId" UUID,
  "locale"           VARCHAR(16),
  "timezone"         VARCHAR(64),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- 7. AuthIdentity — провайдеры входа (future-ready: OAuth, SMS)
CREATE TABLE "AuthIdentity" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "userId"          UUID          NOT NULL,
  "provider"        "AuthProvider" NOT NULL,
  "providerSubject" TEXT,
  "isPrimary"       BOOLEAN       NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthIdentity_provider_providerSubject_key" UNIQUE ("provider", "providerSubject"),
  CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- 8. Мигрируем существующих Telegram-пользователей в AuthIdentity
INSERT INTO "AuthIdentity" ("userId", "provider", "providerSubject", "isPrimary")
SELECT "id", 'TELEGRAM'::"AuthProvider", "telegramId", false
FROM "User"
WHERE "telegramId" IS NOT NULL;
