import { Module }         from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService }    from './files.service';
import { StorageService }  from './storage.service';
import { AuditModule }     from '../audit/audit.module';

@Module({
    imports:     [AuditModule],
    controllers: [FilesController],
    providers:   [FilesService, StorageService],
    exports:     [FilesService, StorageService],
})
export class FilesModule {}
