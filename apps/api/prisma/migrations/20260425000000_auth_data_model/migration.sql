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
  ADD COLUMN "phone"           TEXT         UNIQUE,
  ADD COLUMN "status"          "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt"     TIMESTAMP(3);

-- Существующие MVP-пользователи уже работали — переводим их в ACTIVE
UPDATE "User"
SET
  "status"          = 'ACTIVE',
  "emailVerifiedAt" = "createdAt"
WHERE "status" = 'PENDING_VERIFICATION';

-- 3. AuthSession — серверные сессии с refresh token rotation
CREATE TABLE "AuthSession" (
  "id"               TEXT         NOT NULL,
  "userId"           TEXT         NOT NULL,
  "refreshTokenHash" TEXT         NOT NULL,
  "status"           "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "ip"               TEXT,
  "userAgent"        TEXT,
  "lastSeenAt"       TIMESTAMP(3),
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "revokedAt"        TIMESTAMP(3),
  "revokeReason"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSession_refreshTokenHash_key" UNIQUE ("refreshTokenHash"),
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "AuthSession_userId_status_idx" ON "AuthSession"("userId", "status");

-- 4. EmailVerificationChallenge — одноразовые токены подтверждения email
CREATE TABLE "EmailVerificationChallenge" (
  "id"            TEXT         NOT NULL,
  "userId"        TEXT         NOT NULL,
  "emailSnapshot" TEXT         NOT NULL,
  "tokenHash"     TEXT         NOT NULL,
  "status"        "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "usedAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailVerificationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailVerificationChallenge_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "EmailVerificationChallenge_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "EmailVerificationChallenge_userId_idx" ON "EmailVerificationChallenge"("userId");

-- 5. PasswordResetChallenge — одноразовые токены сброса пароля
CREATE TABLE "PasswordResetChallenge" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "tokenHash" TEXT         NOT NULL,
  "status"    "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordResetChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetChallenge_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "PasswordResetChallenge_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "PasswordResetChallenge_userId_idx" ON "PasswordResetChallenge"("userId");

-- 6. UserPreference — настройки пользователя
CREATE TABLE "UserPreference" (
  "userId"           TEXT NOT NULL,
  "lastUsedTenantId" TEXT,
  "locale"           TEXT,
  "timezone"         TEXT,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- 7. AuthIdentity — провайдеры входа (future-ready: OAuth, SMS)
CREATE TABLE "AuthIdentity" (
  "id"              TEXT         NOT NULL,
  "userId"          TEXT         NOT NULL,
  "provider"        "AuthProvider" NOT NULL,
  "providerSubject" TEXT,
  "isPrimary"       BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthIdentity_provider_providerSubject_key" UNIQUE ("provider", "providerSubject"),
  CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- 8. telegramId → AuthIdentity migration выполняется отдельно после
-- применения всей migration history (telegramId добавлен вне Prisma migrations)
