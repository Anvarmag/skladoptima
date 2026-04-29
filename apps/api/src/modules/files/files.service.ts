import {
    Injectable,
    ForbiddenException,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { PrismaService }       from '../../prisma/prisma.service';
import { StorageService }      from './storage.service';
import { AuditService }        from '../audit/audit.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ConfirmUploadDto }    from './dto/confirm-upload.dto';
import { ReplaceFileDto }      from './dto/replace-file.dto';
import {
    ALLOWED_MIME_TYPES,
    MIME_TO_EXT,
    MAX_FILE_SIZE_BYTES,
    DEFAULT_UPLOAD_TTL_SEC,
    DEFAULT_ACCESS_TTL_SEC,
    UPLOAD_ROLES_ALLOWED,
    READ_BLOCKED_STATES,
    RETENTION_WINDOW_DAYS,
    ORPHAN_WINDOW_SEC,
} from './files.constants';
import { AUDIT_EVENTS } from '../audit/audit-event-catalog';
import { AuditActorType, AuditSource, FileEntityType, FileStatus, FileStorageProvider, FileVisibility } from '@prisma/client';

@Injectable()
export class FilesService {
    private readonly logger = new Logger(FilesService.name);
    private readonly uploadTtlSec: number;

    private readonly accessTtlSec: number;

    constructor(
        private readonly prisma:   PrismaService,
        private readonly storage:  StorageService,
        private readonly audit:    AuditService,
    ) {
        this.uploadTtlSec = Number(process.env.STORAGE_PRESIGN_TTL_SEC) || DEFAULT_UPLOAD_TTL_SEC;
        this.accessTtlSec = Number(process.env.STORAGE_ACCESS_TTL_SEC)  || DEFAULT_ACCESS_TTL_SEC;
    }

    // ─── RBAC / Access-state guards ───────────────────────────────────────────

    private async assertCanWrite(tenantId: string, userId: string): Promise<string> {
        const membership = await this.prisma.membership.findFirst({
            where:  { tenantId, userId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!membership || !UPLOAD_ROLES_ALLOWED.has(membership.role as string)) {
            throw new ForbiddenException({ code: 'FILE_WRITE_FORBIDDEN' });
        }
        return membership.role as string;
    }

    private async assertCanRead(tenantId: string, userId: string): Promise<void> {
        const membership = await this.prisma.membership.findFirst({
            where:  { tenantId, userId, status: 'ACTIVE' },
            select: { id: true },
        });
        if (!membership) {
            throw new ForbiddenException({ code: 'FILE_READ_FORBIDDEN' });
        }
    }

    private assertReadAllowedByTenantState(accessState: string | undefined): void {
        if (accessState && READ_BLOCKED_STATES.has(accessState)) {
            this.logger.warn(JSON.stringify({
                metric:      'access_denied',
                reason:      'tenant_state_blocks_read',
                accessState,
                ts:          new Date().toISOString(),
            }));
            throw new ForbiddenException({
                code:        'FILE_READ_BLOCKED_BY_TENANT_STATE',
                accessState,
            });
        }
    }

    // ─── requestUploadUrl ─────────────────────────────────────────────────────

    /**
     * POST /files/upload-url
     *
     * Алгоритм (system-analytics §9):
     *   1. RBAC — OWNER/ADMIN/MANAGER
     *   2. Валидация MIME (allowlist jpg/png/webp)
     *   3. Валидация размера (<= 10 MB)
     *   4. Проверка entity ownership (product принадлежит tenant)
     *   5. Формирование object key: {tenantId}/products/{fileId}.{ext}
     *   6. CREATE File(status=uploading) + FileLifecycleEvent(upload_requested)
     *   7. Presigned PUT URL
     */
    async requestUploadUrl(tenantId: string, userId: string, dto: RequestUploadUrlDto) {
        await this.assertCanWrite(tenantId, userId);

        const normalizedMime = dto.mimeType.toLowerCase().trim();
        if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
            this.logger.warn(JSON.stringify({
                metric:   'uploads_failed',
                reason:   'format_not_allowed',
                mimeType: normalizedMime,
                tenantId,
                userId,
                ts:       new Date().toISOString(),
            }));
            throw new BadRequestException({
                code:    'FILE_FORMAT_NOT_ALLOWED',
                allowed: [...ALLOWED_MIME_TYPES],
            });
        }

        if (dto.sizeBytes > MAX_FILE_SIZE_BYTES) {
            this.logger.warn(JSON.stringify({
                metric:    'uploads_failed',
                reason:    'file_too_large',
                sizeBytes: dto.sizeBytes,
                maxBytes:  MAX_FILE_SIZE_BYTES,
                tenantId,
                userId,
                ts:        new Date().toISOString(),
            }));
            throw new BadRequestException({
                code:     'FILE_TOO_LARGE',
                maxBytes: MAX_FILE_SIZE_BYTES,
            });
        }

        // Verify entity ownership: product must exist and belong to this tenant
        if (dto.entityType === FileEntityType.product_main_image) {
            const product = await this.prisma.product.findFirst({
                where:  { id: dto.entityId, tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!product) {
                throw new NotFoundException({ code: 'FILE_ENTITY_NOT_FOUND' });
            }
        }

        // Object key: {tenantId}/products/{fileId}.{ext}
        // Original filename is stored as metadata ONLY — never in the key.
        const ext       = MIME_TO_EXT[normalizedMime];
        const fileId    = crypto.randomUUID();
        const objectKey = `${tenantId}/products/${fileId}.${ext}`;
        const now       = new Date();

        await this.prisma.$transaction(async (tx) => {
            await tx.file.create({
                data: {
                    id:               fileId,
                    tenantId,
                    entityType:       dto.entityType,
                    entityId:         dto.entityId,
                    objectKey,
                    bucket:           this.storage.bucket,
                    storageProvider:  FileStorageProvider.s3_compatible,
                    mimeType:         normalizedMime,
                    sizeBytes:        dto.sizeBytes,
                    originalFilename: dto.originalFilename ?? null,
                    status:           FileStatus.uploading,
                    visibility:       FileVisibility.private,
                    uploadedBy:       userId,
                    uploadedAt:       now,
                },
            });
            await tx.fileLifecycleEvent.create({
                data: {
                    id:        crypto.randomUUID(),
                    fileId,
                    eventType: 'upload_requested',
                    payload:   {
                        mimeType:   normalizedMime,
                        sizeBytes:  dto.sizeBytes,
                        entityType: dto.entityType,
                        entityId:   dto.entityId,
                    },
                },
            });
        });

        const uploadUrl = await this.storage.presignedPutUrl(objectKey, normalizedMime, this.uploadTtlSec);

        this.logger.log(JSON.stringify({
            metric:     'uploads_started',
            tenantId,
            fileId,
            entityType: dto.entityType,
            entityId:   dto.entityId,
            sizeBytes:  dto.sizeBytes,
            ts:         now.toISOString(),
        }));

        return { fileId, uploadUrl, objectKey, expiresInSec: this.uploadTtlSec };
    }

    // ─── confirmUpload ────────────────────────────────────────────────────────

    /**
     * POST /files/confirm
     *
     * Алгоритм (system-analytics §9):
     *   1. RBAC → возвращает роль для аудита
     *   2. Найти File(status=uploading) по fileId + tenantId
     *   3. HeadObject → проверить existence
     *   4. Проверить size в пределах допуска (1%)
     *   5. Проверить Content-Type
     *   6. Проверить checksum если передан
     *   7. Транзакция:
     *      a. UPDATE File(status=active) + FileLifecycleEvent(upload_confirmed)
     *      b. Catalog linkage: Product.mainImageFileId = fileId
     *         Если product уже имел mainImageFileId → старый файл → replaced
     *   8. Audit event FILE_UPLOADED
     */
    async confirmUpload(tenantId: string, userId: string, dto: ConfirmUploadDto) {
        const actorRole = await this.assertCanWrite(tenantId, userId);

        const file = await this.prisma.file.findFirst({
            where: { id: dto.fileId, tenantId, status: FileStatus.uploading },
        });
        if (!file) {
            throw new NotFoundException({ code: 'FILE_UPLOAD_OBJECT_NOT_FOUND' });
        }

        // Check object exists in S3
        const head = await this.storage.headObject(file.objectKey);
        if (!head) {
            await this.prisma.fileLifecycleEvent.create({
                data: {
                    id:        crypto.randomUUID(),
                    fileId:    file.id,
                    eventType: 'confirm_failed_object_missing',
                    payload:   { objectKey: file.objectKey },
                },
            });
            this.logger.warn(JSON.stringify({
                metric:    'uploads_failed',
                reason:    'object_not_found',
                tenantId,
                fileId:    file.id,
                objectKey: file.objectKey,
                ts:        new Date().toISOString(),
            }));
            throw new NotFoundException({ code: 'FILE_UPLOAD_OBJECT_NOT_FOUND' });
        }

        // Validate size (allow ≤1% tolerance for multipart edge cases)
        const declaredSize = Number(file.sizeBytes ?? 0);
        const tolerance    = Math.max(declaredSize * 0.01, 512);
        if (Math.abs(head.contentLength - declaredSize) > tolerance) {
            throw new BadRequestException({
                code:     'FILE_SIZE_MISMATCH',
                declared: declaredSize,
                actual:   head.contentLength,
            });
        }

        // Validate Content-Type (normalised: strip charset suffix, treat jpeg/jpg as equivalent)
        if (file.mimeType && head.contentType) {
            const actualBase   = head.contentType.split(';')[0].trim().toLowerCase();
            const declaredMime = (file.mimeType as string).toLowerCase();
            const bothJpeg     = ['image/jpeg', 'image/jpg'];
            const mimeMatch    = actualBase === declaredMime || (bothJpeg.includes(actualBase) && bothJpeg.includes(declaredMime));
            if (!mimeMatch) {
                throw new BadRequestException({
                    code:     'FILE_MIME_MISMATCH',
                    declared: declaredMime,
                    actual:   actualBase,
                });
            }
        }

        // Validate checksum if provided by client and returned by S3
        if (dto.checksumSha256 && head.checksumSha256) {
            if (dto.checksumSha256.toLowerCase() !== head.checksumSha256.toLowerCase()) {
                throw new BadRequestException({ code: 'FILE_CHECKSUM_MISMATCH' });
            }
        }

        const now = new Date();
        let displacedFileId: string | null = null;

        const updated = await this.prisma.$transaction(async (tx) => {
            const result = await tx.file.update({
                where: { id: file.id },
                data: {
                    status:         FileStatus.active,
                    checksumSha256: dto.checksumSha256 ?? head.checksumSha256 ?? null,
                    uploadedAt:     now,
                    updatedAt:      now,
                },
            });
            await tx.fileLifecycleEvent.create({
                data: {
                    id:        crypto.randomUUID(),
                    fileId:    file.id,
                    eventType: 'upload_confirmed',
                    payload:   {
                        objectKey:      file.objectKey,
                        sizeBytes:      head.contentLength,
                        checksumSha256: dto.checksumSha256 ?? null,
                    },
                },
            });

            // ── Catalog linkage (system-analytics §9 step 5) ──────────────────
            // Attach file to product.mainImageFileId.
            // If the product already has a different active image, displace it to replaced.
            if (file.entityType === FileEntityType.product_main_image && file.entityId) {
                const product = await tx.product.findFirst({
                    where:  { id: file.entityId, tenantId, deletedAt: null },
                    select: { id: true, mainImageFileId: true },
                });
                if (product) {
                    const oldFileId = product.mainImageFileId;
                    if (oldFileId && oldFileId !== file.id) {
                        // Mark the old file as replaced
                        await tx.file.update({
                            where: { id: oldFileId },
                            data:  { status: FileStatus.replaced, updatedAt: now },
                        });
                        await tx.fileLifecycleEvent.create({
                            data: {
                                id:        crypto.randomUUID(),
                                fileId:    oldFileId,
                                eventType: 'file_displaced_by_upload',
                                payload:   { replacedBy: file.id, userId },
                            },
                        });
                        displacedFileId = oldFileId;
                    }
                    // Link new file to product
                    await tx.product.update({
                        where: { id: product.id },
                        data:  { mainImageFileId: file.id, updatedAt: now },
                    });
                }
            }

            return result;
        });

        this.logger.log(JSON.stringify({
            metric:          'uploads_confirmed',
            tenantId,
            fileId:          updated.id,
            sizeBytes:       head.contentLength,
            displacedFileId: displacedFileId ?? undefined,
            ts:              now.toISOString(),
        }));

        // Audit event outside the DB transaction — failure here should not roll back the upload
        await this.audit.writeEvent({
            tenantId,
            eventType:  AUDIT_EVENTS.FILE_UPLOADED,
            entityType: 'file',
            entityId:   updated.id,
            actorType:  AuditActorType.user,
            actorId:    userId,
            actorRole,
            source:     AuditSource.api,
            after: {
                fileId:          updated.id,
                entityType:      file.entityType,
                entityId:        file.entityId,
                objectKey:       updated.objectKey,
                mimeType:        updated.mimeType,
                sizeBytes:       updated.sizeBytes !== null ? Number(updated.sizeBytes) : null,
                displacedFileId: displacedFileId ?? undefined,
            },
        }).catch(err => this.logger.error(JSON.stringify({
            metric: 'audit_write_failure',
            event:  AUDIT_EVENTS.FILE_UPLOADED,
            fileId: updated.id,
            error:  err?.message ?? String(err),
        })));

        return {
            fileId:          updated.id,
            objectKey:       updated.objectKey,
            mimeType:        updated.mimeType,
            sizeBytes:       updated.sizeBytes !== null ? Number(updated.sizeBytes) : null,
            checksumSha256:  updated.checksumSha256,
            status:          updated.status,
            createdAt:       updated.createdAt,
            displacedFileId: displacedFileId ?? undefined,
        };
    }

    // ─── getAccessUrl ─────────────────────────────────────────────────────────

    /**
     * GET /files/:fileId/access-url
     *
     * Алгоритм (system-analytics §14):
     *   1. Проверить tenant access-state: SUSPENDED/CLOSED → 403
     *   2. RBAC: любой active member tenant может читать
     *   3. Найти File(status=active, tenantId) — tenant-scope предотвращает cross-tenant доступ
     *   4. Выдать короткоживущий presigned GET URL (TTL = STORAGE_ACCESS_TTL_SEC || 300s)
     *   5. Записать lifecycle event и метрику
     */
    async getAccessUrl(tenantId: string, userId: string, fileId: string, accessState?: string) {
        // Access-state policy: SUSPENDED/CLOSED блокируют user-facing access URL
        this.assertReadAllowedByTenantState(accessState);

        // RBAC: любой active member может читать
        await this.assertCanRead(tenantId, userId);

        // Tenant-scoped lookup — если fileId принадлежит другому tenant, вернём 404,
        // а не 403, чтобы не раскрывать факт существования объекта (information disclosure).
        const file = await this.prisma.file.findFirst({
            where: { id: fileId, tenantId, status: FileStatus.active },
            select: { id: true, objectKey: true, mimeType: true },
        });
        if (!file) {
            throw new NotFoundException({ code: 'FILE_NOT_FOUND' });
        }

        const accessUrl = await this.storage.presignedGetUrl(file.objectKey, this.accessTtlSec);
        const now       = new Date();

        await this.prisma.fileLifecycleEvent.create({
            data: {
                id:        crypto.randomUUID(),
                fileId:    file.id,
                eventType: 'access_url_issued',
                payload:   { userId, expiresInSec: this.accessTtlSec },
            },
        });

        this.logger.log(JSON.stringify({
            metric:   'signed_urls_generated',
            kind:     'get',
            tenantId,
            fileId:   file.id,
            userId,
            ts:       now.toISOString(),
        }));

        return { fileId: file.id, accessUrl, expiresInSec: this.accessTtlSec };
    }

    // ─── replaceFile ──────────────────────────────────────────────────────────

    /**
     * POST /files/:oldFileId/replace  { newFileId }
     *
     * Атомарно переключает доменную ссылку product.mainImageFileId с oldFile на newFile.
     * Старый файл переводится в статус `replaced` и войдёт в cleanup pipeline.
     *
     * Алгоритм:
     *   1. RBAC
     *   2. Найти oldFile (active, tenantId)
     *   3. Найти newFile (active, tenantId, тот же entityType/entityId)
     *   4. Убедиться, что newFile ≠ oldFile
     *   5. Транзакция: oldFile→replaced, Product.mainImageFileId→newFileId, lifecycle events
     */
    async replaceFile(tenantId: string, userId: string, oldFileId: string, dto: ReplaceFileDto) {
        const actorRole = await this.assertCanWrite(tenantId, userId);

        const [oldFile, newFile] = await Promise.all([
            this.prisma.file.findFirst({
                where:  { id: oldFileId, tenantId, status: FileStatus.active },
                select: { id: true, objectKey: true, entityType: true, entityId: true },
            }),
            this.prisma.file.findFirst({
                where:  { id: dto.newFileId, tenantId, status: FileStatus.active },
                select: { id: true, entityType: true, entityId: true },
            }),
        ]);

        if (!oldFile) {
            throw new NotFoundException({ code: 'FILE_NOT_FOUND' });
        }
        if (!newFile) {
            throw new NotFoundException({ code: 'REPLACE_NEW_FILE_NOT_FOUND' });
        }
        if (oldFile.id === newFile.id) {
            throw new BadRequestException({ code: 'REPLACE_SAME_FILE' });
        }
        if (oldFile.entityType !== newFile.entityType || oldFile.entityId !== newFile.entityId) {
            throw new BadRequestException({ code: 'REPLACE_ENTITY_MISMATCH' });
        }

        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            // Mark old file as replaced
            await tx.file.update({
                where: { id: oldFile.id },
                data:  { status: FileStatus.replaced, updatedAt: now },
            });

            // Switch product reference to new file (only for product_main_image entity type)
            if (oldFile.entityType === FileEntityType.product_main_image && oldFile.entityId) {
                await tx.product.updateMany({
                    where: { id: oldFile.entityId, tenantId, mainImageFileId: oldFile.id },
                    data:  { mainImageFileId: newFile.id, updatedAt: now },
                });
            }

            // Lifecycle events
            await tx.fileLifecycleEvent.createMany({
                data: [
                    {
                        id:        crypto.randomUUID(),
                        fileId:    oldFile.id,
                        eventType: 'file_replaced',
                        payload:   { replacedBy: newFile.id, userId },
                    },
                    {
                        id:        crypto.randomUUID(),
                        fileId:    newFile.id,
                        eventType: 'file_became_active_via_replace',
                        payload:   { replacedFileId: oldFile.id, userId },
                    },
                ],
            });
        });

        this.logger.log(JSON.stringify({
            metric:      'file_replaced',
            tenantId,
            oldFileId:   oldFile.id,
            newFileId:   newFile.id,
            userId,
            ts:          now.toISOString(),
        }));

        await this.audit.writeEvent({
            tenantId,
            eventType:  AUDIT_EVENTS.FILE_REPLACED,
            entityType: 'file',
            entityId:   oldFile.id,
            actorType:  AuditActorType.user,
            actorId:    userId,
            actorRole,
            source:     AuditSource.api,
            before: { fileId: oldFile.id, status: 'active' },
            after:  {
                oldFileId:  oldFile.id,
                newFileId:  newFile.id,
                entityType: oldFile.entityType,
                entityId:   oldFile.entityId,
            },
        }).catch(err => this.logger.error(JSON.stringify({
            metric: 'audit_write_failure',
            event:  AUDIT_EVENTS.FILE_REPLACED,
            fileId: oldFile.id,
            error:  err?.message ?? String(err),
        })));

        return { oldFileId: oldFile.id, newFileId: newFile.id, status: 'replaced' };
    }

    // ─── deleteFile ───────────────────────────────────────────────────────────

    /**
     * DELETE /files/:fileId
     *
     * Логическое удаление: переводит файл в `deleted`, убирает ссылку из product.
     * Физическое удаление из S3 происходит в cleanup job после retention window.
     */
    async deleteFile(tenantId: string, userId: string, fileId: string) {
        const actorRole = await this.assertCanWrite(tenantId, userId);

        const file = await this.prisma.file.findFirst({
            where:  { id: fileId, tenantId, status: { in: [FileStatus.active, FileStatus.replaced] } },
            select: { id: true, objectKey: true, entityType: true, entityId: true, status: true },
        });
        if (!file) {
            throw new NotFoundException({ code: 'FILE_NOT_FOUND' });
        }

        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            await tx.file.update({
                where: { id: file.id },
                data:  { status: FileStatus.deleted, deletedAt: now, updatedAt: now },
            });

            // Remove product reference if this file is currently linked
            if (file.entityType === FileEntityType.product_main_image && file.entityId) {
                await tx.product.updateMany({
                    where: { id: file.entityId, tenantId, mainImageFileId: file.id },
                    data:  { mainImageFileId: null, updatedAt: now },
                });
            }

            await tx.fileLifecycleEvent.create({
                data: {
                    id:        crypto.randomUUID(),
                    fileId:    file.id,
                    eventType: 'file_deleted',
                    payload:   { userId, previousStatus: file.status },
                },
            });
        });

        this.logger.log(JSON.stringify({
            metric:  'file_deleted',
            tenantId,
            fileId:  file.id,
            userId,
            ts:      now.toISOString(),
        }));

        await this.audit.writeEvent({
            tenantId,
            eventType:  AUDIT_EVENTS.FILE_DELETED,
            entityType: 'file',
            entityId:   file.id,
            actorType:  AuditActorType.user,
            actorId:    userId,
            actorRole,
            source:     AuditSource.api,
            before: {
                fileId:     file.id,
                status:     file.status,
                entityType: file.entityType,
                entityId:   file.entityId,
            },
            after: { status: 'deleted' },
        }).catch(err => this.logger.error(JSON.stringify({
            metric: 'audit_write_failure',
            event:  AUDIT_EVENTS.FILE_DELETED,
            fileId: file.id,
            error:  err?.message ?? String(err),
        })));

        return { fileId: file.id, status: 'deleted' };
    }

    // ─── runCleanup ───────────────────────────────────────────────────────────

    /**
     * POST /files/cleanup/reconcile  (internal)
     *
     * Двухфазный cleanup job:
     *
     * Фаза 1 — Mark:
     *   a) uploading файлы старше ORPHAN_WINDOW_SEC → orphaned
     *   b) replaced/orphaned/deleted старше RETENTION_WINDOW_DAYS → cleanup_pending
     *
     * Фаза 2 — Purge (cleanup_pending → hard-delete record + S3 object):
     *   Для каждого cleanup_pending файла удаляем объект из S3, затем запись из БД.
     *   При ошибке S3 — статус cleanup_failed + lifecycle event.
     *
     * Фаза 3 — Reconcile:
     *   Находим active/uploading файлы, у которых объект в S3 отсутствует (HeadObject 404).
     *   Переводим в orphaned + создаём lifecycle event 'reconcile_object_missing'.
     *   В MVP ограничиваем reconcile батч до 50 записей за запуск.
     */
    async runCleanup() {
        const now          = new Date();
        const orphanBefore = new Date(now.getTime() - ORPHAN_WINDOW_SEC * 1000);
        const purgeBefore  = new Date(now.getTime() - RETENTION_WINDOW_DAYS * 24 * 3600 * 1000);

        const result = {
            orphaned:       0,
            cleanupPending: 0,
            purged:         0,
            purgeFailed:    0,
            reconciled:     0,
        };

        // ── Phase 1a: uploading → orphaned ──────────────────────────────────
        const orphaned = await this.prisma.file.findMany({
            where:  { status: FileStatus.uploading, createdAt: { lt: orphanBefore } },
            select: { id: true },
        });
        if (orphaned.length > 0) {
            await this.prisma.file.updateMany({
                where: { id: { in: orphaned.map(f => f.id) } },
                data:  { status: FileStatus.orphaned, updatedAt: now },
            });
            await this.prisma.fileLifecycleEvent.createMany({
                data: orphaned.map(f => ({
                    id:        crypto.randomUUID(),
                    fileId:    f.id,
                    eventType: 'upload_orphaned',
                    payload:   { reason: 'confirm_timeout', markedAt: now.toISOString() },
                })),
            });
            result.orphaned = orphaned.length;
        }

        // ── Phase 1b: replaced/orphaned/deleted → cleanup_pending ───────────
        const toCleanup = await this.prisma.file.findMany({
            where: {
                status:    { in: [FileStatus.replaced, FileStatus.orphaned, FileStatus.deleted] },
                updatedAt: { lt: purgeBefore },
            },
            select: { id: true },
        });
        if (toCleanup.length > 0) {
            await this.prisma.file.updateMany({
                where: { id: { in: toCleanup.map(f => f.id) } },
                data:  { status: FileStatus.cleanup_pending, updatedAt: now },
            });
            result.cleanupPending = toCleanup.length;
        }

        // ── Phase 2: cleanup_pending → purge ────────────────────────────────
        const pending = await this.prisma.file.findMany({
            where:  { status: FileStatus.cleanup_pending },
            select: { id: true, objectKey: true, tenantId: true, entityType: true, entityId: true },
            take:   100,
        });

        for (const file of pending) {
            try {
                await this.storage.deleteObject(file.objectKey);
                await this.prisma.file.delete({ where: { id: file.id } });
                result.purged++;
                // Audit critical cleanup decision: physical deletion from S3
                await this.audit.writeEvent({
                    tenantId:   file.tenantId,
                    eventType:  AUDIT_EVENTS.FILE_CLEANUP_PURGED,
                    entityType: 'file',
                    entityId:   file.id,
                    actorType:  AuditActorType.system,
                    source:     AuditSource.worker,
                    metadata:   { objectKey: file.objectKey, entityType: file.entityType, entityId: file.entityId },
                }).catch(() => { /* non-critical: log only */ });
            } catch (err: any) {
                await this.prisma.file.update({
                    where: { id: file.id },
                    data:  { status: FileStatus.cleanup_failed, updatedAt: now },
                });
                await this.prisma.fileLifecycleEvent.create({
                    data: {
                        id:        crypto.randomUUID(),
                        fileId:    file.id,
                        eventType: 'cleanup_failed',
                        payload:   { error: err?.message ?? String(err) },
                    },
                });
                result.purgeFailed++;
            }
        }

        // ── Phase 3: reconcile orphaned objects ─────────────────────────────
        const suspects = await this.prisma.file.findMany({
            where:  { status: { in: [FileStatus.active, FileStatus.uploading] } },
            select: { id: true, objectKey: true },
            take:   50,
            orderBy: { createdAt: 'asc' },
        });

        for (const file of suspects) {
            const head = await this.storage.headObject(file.objectKey).catch(() => null);
            if (head === null) {
                await this.prisma.file.update({
                    where: { id: file.id },
                    data:  { status: FileStatus.orphaned, updatedAt: now },
                });
                await this.prisma.fileLifecycleEvent.create({
                    data: {
                        id:        crypto.randomUUID(),
                        fileId:    file.id,
                        eventType: 'reconcile_object_missing',
                        payload:   { objectKey: file.objectKey },
                    },
                });
                result.reconciled++;
            }
        }

        this.logger.log(JSON.stringify({
            metric: 'cleanup_backlog',
            ...result,
            ts:     now.toISOString(),
        }));

        if (result.reconciled > 0) {
            this.logger.warn(JSON.stringify({
                metric: 'orphan_files_detected',
                count:  result.reconciled,
                ts:     now.toISOString(),
            }));
        }

        return result;
    }
}
