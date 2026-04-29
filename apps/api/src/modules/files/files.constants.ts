// Разрешённые MIME-типы для загрузки медиафайлов товаров.
export const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);

// Расширение файла по MIME-типу (используется ТОЛЬКО при формировании object key).
export const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg':  'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
};

// 10 МБ — максимальный допустимый размер загружаемого файла (system-analytics §10).
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// TTL presigned PUT URL по умолчанию (переопределяется через STORAGE_PRESIGN_TTL_SEC).
export const DEFAULT_UPLOAD_TTL_SEC = 900; // 15 min

// Роли, которым разрешён upload/replace (system-analytics §3).
export const UPLOAD_ROLES_ALLOWED = new Set(['OWNER', 'ADMIN', 'MANAGER']);

// TTL presigned GET URL по умолчанию (system-analytics §18: короткий TTL).
export const DEFAULT_ACCESS_TTL_SEC = 300; // 5 min

// Tenant access states, при которых user-facing access URL не выдаются (system-analytics §14).
// TRIAL_EXPIRED намеренно ОТСУТСТВУЕТ — read существующих active файлов разрешён.
export const READ_BLOCKED_STATES = new Set(['SUSPENDED', 'CLOSED']);

// Retention window для replaced/orphaned/deleted файлов перед физическим удалением (system-analytics §22).
export const RETENTION_WINDOW_DAYS = 7;

// Окно, после которого незавершённый uploading считается orphaned (в секундах).
// По умолчанию 2× TTL presigned PUT URL (~30 мин) с запасом.
export const ORPHAN_WINDOW_SEC = 1800; // 30 min
