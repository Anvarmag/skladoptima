import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { FilesService }           from './files.service';
import { RequestUploadUrlDto }    from './dto/request-upload-url.dto';
import { ConfirmUploadDto }       from './dto/confirm-upload.dto';
import { ReplaceFileDto }         from './dto/replace-file.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard }       from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('files')
export class FilesController {
    constructor(private readonly filesService: FilesService) {}

    /**
     * POST /api/files/upload-url
     *
     * Выдаёт presigned S3 PUT URL для прямой загрузки файла клиентом.
     * Создаёт File(status=uploading) запись.
     *
     * RBAC: OWNER / ADMIN / MANAGER
     * Tenant state: TRIAL_EXPIRED / SUSPENDED / CLOSED → 403 (TenantWriteGuard)
     */
    @Post('upload-url')
    @UseGuards(TenantWriteGuard)
    requestUploadUrl(@Body() dto: RequestUploadUrlDto, @Req() req: any) {
        return this.filesService.requestUploadUrl(req.activeTenantId, req.user.id, dto);
    }

    /**
     * POST /api/files/confirm
     *
     * Подтверждает загрузку: проверяет existence/size/mime/checksum объекта в S3,
     * переводит File в status=active.
     *
     * RBAC: OWNER / ADMIN / MANAGER
     * Tenant state: TRIAL_EXPIRED / SUSPENDED / CLOSED → 403 (TenantWriteGuard)
     */
    @Post('confirm')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    confirmUpload(@Body() dto: ConfirmUploadDto, @Req() req: any) {
        return this.filesService.confirmUpload(req.activeTenantId, req.user.id, dto);
    }

    /**
     * GET /api/files/:fileId/access-url
     *
     * Выдаёт короткоживущий presigned GET URL для чтения файла.
     * Tenant-scope lookup предотвращает cross-tenant доступ на уровне БД.
     *
     * RBAC: любой active member tenant
     * Tenant state: TRIAL_EXPIRED → разрешено (read active files)
     *               SUSPENDED / CLOSED → 403 (FILE_READ_BLOCKED_BY_TENANT_STATE)
     */
    @Get(':fileId/access-url')
    getAccessUrl(@Param('fileId') fileId: string, @Req() req: any) {
        return this.filesService.getAccessUrl(
            req.activeTenantId,
            req.user.id,
            fileId,
            req.activeTenant?.accessState,
        );
    }

    /**
     * POST /api/files/cleanup/reconcile
     *
     * Internal endpoint для cleanup job (вызывается worker'ом из модуля 18-worker).
     * Выполняет трёхфазный lifecycle cleanup:
     *   1. uploading → orphaned (confirm timeout)
     *   2. replaced/orphaned/deleted → cleanup_pending (retention window = 7 дней)
     *   3. cleanup_pending → S3 delete + hard-delete DB record
     *   + reconcile: active файлы без объекта в S3 → orphaned
     *
     * Объявлен до :fileId/* чтобы NestJS не путал с параметрическими маршрутами.
     */
    @Post('cleanup/reconcile')
    @HttpCode(HttpStatus.OK)
    runCleanup() {
        return this.filesService.runCleanup();
    }

    /**
     * POST /api/files/:fileId/replace  { newFileId }
     *
     * Атомарно заменяет файл в доменной сущности (product.mainImageFileId).
     * Старый файл → replaced → cleanup pipeline после retention window.
     * Новый файл должен быть уже в статусе active (после /confirm).
     *
     * RBAC: OWNER / ADMIN / MANAGER
     * Tenant state: TRIAL_EXPIRED / SUSPENDED / CLOSED → 403 (TenantWriteGuard)
     */
    @Post(':fileId/replace')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    replaceFile(
        @Param('fileId') fileId: string,
        @Body() dto: ReplaceFileDto,
        @Req() req: any,
    ) {
        return this.filesService.replaceFile(req.activeTenantId, req.user.id, fileId, dto);
    }

    /**
     * DELETE /api/files/:fileId
     *
     * Логическое удаление файла. Убирает ссылку из product.mainImageFileId.
     * Физическое удаление из S3 происходит в cleanup job после retention window (7 дней).
     *
     * RBAC: OWNER / ADMIN / MANAGER
     * Tenant state: TRIAL_EXPIRED / SUSPENDED / CLOSED → 403 (TenantWriteGuard)
     */
    @Delete(':fileId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    deleteFile(@Param('fileId') fileId: string, @Req() req: any) {
        return this.filesService.deleteFile(req.activeTenantId, req.user.id, fileId);
    }
}
