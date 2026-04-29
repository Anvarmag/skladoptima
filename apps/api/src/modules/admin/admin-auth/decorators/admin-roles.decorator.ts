import { SetMetadata } from '@nestjs/common';
import { SupportUserRole } from '@prisma/client';

export const ADMIN_ROLES_KEY = 'adminRoles';

/// Ограничение роли support-actor. Если декоратор не указан, по умолчанию
/// требуется любая активная support-роль (см. AdminAuthGuard). Mutating
/// support actions ОБЯЗАНЫ объявлять @AdminRoles('SUPPORT_ADMIN'), иначе
/// SUPPORT_READONLY получит mutating endpoint — нарушение §15 аналитики.
export const AdminRoles = (...roles: SupportUserRole[]) =>
    SetMetadata(ADMIN_ROLES_KEY, roles);
