import { SetMetadata } from '@nestjs/common';

export const IS_ADMIN_PUBLIC_KEY = 'isAdminPublic';

/// Pre-auth admin endpoint (login, refresh, csrf-token). AdminAuthGuard
/// пропускает аутентификацию, но CSRF/SOFT-LOCK/прочие проверки остаются
/// на уровне сервиса.
export const AdminPublic = () => SetMetadata(IS_ADMIN_PUBLIC_KEY, true);
