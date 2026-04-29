import { applyDecorators, SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator';
import { SKIP_CSRF_KEY } from '../../../auth/skip-csrf.decorator';
import { SKIP_TENANT_GUARD_KEY } from '../../../tenants/decorators/skip-tenant-guard.decorator';

export const IS_ADMIN_ENDPOINT_KEY = 'isAdminEndpoint';

/// Маркер admin-плоскости. Делает три вещи:
///   1) Помечает endpoint как Public для глобального tenant JwtAuthGuard
///      — admin-плоскость не валидируется обычным tenant JWT.
///   2) Скипает глобальный CsrfGuard (admin использует свой CSRF cookie/header).
///   3) Скипает ActiveTenantGuard — у support_user нет tenant picker.
/// Безопасность admin endpoints обеспечивает локальный AdminAuthGuard,
/// поэтому "Public" здесь означает только "не tenant-auth", не "open".
export const AdminEndpoint = () =>
    applyDecorators(
        SetMetadata(IS_ADMIN_ENDPOINT_KEY, true),
        SetMetadata(IS_PUBLIC_KEY, true),
        SetMetadata(SKIP_CSRF_KEY, true),
        SetMetadata(SKIP_TENANT_GUARD_KEY, true),
    );
