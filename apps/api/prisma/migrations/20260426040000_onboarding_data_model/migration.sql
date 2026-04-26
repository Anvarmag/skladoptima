-- CreateEnum
CREATE TYPE "OnboardingScope" AS ENUM ('USER_BOOTSTRAP', 'TENANT_ACTIVATION');
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CLOSED');
CREATE TYPE "OnboardingStepStatus" AS ENUM ('PENDING', 'VIEWED', 'DONE', 'SKIPPED');

-- CreateTable: OnboardingState
CREATE TABLE "OnboardingState" (
    "id"             TEXT NOT NULL,
    "scope"          "OnboardingScope" NOT NULL,
    "status"         "OnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "catalogVersion" TEXT NOT NULL DEFAULT 'v1',
    "lastStepKey"    TEXT,
    "completedAt"    TIMESTAMP(3),
    "closedAt"       TIMESTAMP(3),
    "userId"         TEXT,
    "tenantId"       TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OnboardingStepProgress
CREATE TABLE "OnboardingStepProgress" (
    "id"                TEXT NOT NULL,
    "onboardingStateId" TEXT NOT NULL,
    "stepKey"           TEXT NOT NULL,
    "status"            "OnboardingStepStatus" NOT NULL DEFAULT 'PENDING',
    "viewedAt"          TIMESTAMP(3),
    "completedAt"       TIMESTAMP(3),
    "skippedAt"         TIMESTAMP(3),
    "metadata"          JSONB,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingStepProgress_pkey" PRIMARY KEY ("id")
);

-- Unique: один USER_BOOTSTRAP на пользователя, один TENANT_ACTIVATION на tenant
-- PostgreSQL трактует NULL как отдельное значение в уникальных индексах,
-- поэтому строки с userId=NULL (TENANT_ACTIVATION) не конфликтуют между собой.
CREATE UNIQUE INDEX "OnboardingState_userId_scope_key" ON "OnboardingState"("userId", "scope");
CREATE UNIQUE INDEX "OnboardingState_tenantId_scope_key" ON "OnboardingState"("tenantId", "scope");

-- Indexes
CREATE INDEX "OnboardingState_userId_idx" ON "OnboardingState"("userId");
CREATE INDEX "OnboardingState_tenantId_idx" ON "OnboardingState"("tenantId");
CREATE UNIQUE INDEX "OnboardingStepProgress_onboardingStateId_stepKey_key" ON "OnboardingStepProgress"("onboardingStateId", "stepKey");
CREATE INDEX "OnboardingStepProgress_onboardingStateId_idx" ON "OnboardingStepProgress"("onboardingStateId");

-- Foreign Keys
ALTER TABLE "OnboardingState" ADD CONSTRAINT "OnboardingState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingState" ADD CONSTRAINT "OnboardingState_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingStepProgress" ADD CONSTRAINT "OnboardingStepProgress_onboardingStateId_fkey"
    FOREIGN KEY ("onboardingStateId") REFERENCES "OnboardingState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
