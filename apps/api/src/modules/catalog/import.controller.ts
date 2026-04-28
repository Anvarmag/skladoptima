import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportPreviewDto } from './dto/import-preview.dto';
import { ImportCommitDto } from './dto/import-commit.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('catalog/imports')
export class ImportController {
    constructor(private readonly importService: ImportService) {}

    // POST /catalog/imports/preview — создаёт job в статусе PREVIEW, возвращает
    // список строк с решениями create/update/manual_review для подтверждения пользователем.
    @Post('preview')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    preview(@Body() dto: ImportPreviewDto, @Req() req: any) {
        return this.importService.preview(dto, req.activeTenantId, req.user?.id);
    }

    // POST /catalog/imports/commit — применяет PREVIEW-job к мастер-каталогу.
    // Идемпотентен по idempotencyKey: повторный вызов с тем же ключом возвращает
    // результат первого выполнения без повторного создания товаров.
    @Post('commit')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    commit(@Body() dto: ImportCommitDto, @Req() req: any) {
        return this.importService.commit(dto, req.activeTenantId, req.user?.email, req.user?.id);
    }

    // GET /catalog/imports/:jobId — статус и статистика import job
    @Get(':jobId')
    getJob(@Param('jobId') jobId: string, @Req() req: any) {
        return this.importService.getJob(jobId, req.activeTenantId);
    }
}
