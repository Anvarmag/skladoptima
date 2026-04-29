-- TASK_TASKS_4: Task notification fields on UserPreference
-- maxChatId    — MAX-бот chatId пользователя для отправки push (nullable: нет chatId = нет push)
-- taskNotifyPreferences — per-user opt-out по типу события: {"ASSIGNED":true,"COMMENTED":false,...}

ALTER TABLE "UserPreference"
  ADD COLUMN "maxChatId"             TEXT,
  ADD COLUMN "taskNotifyPreferences" JSONB;
