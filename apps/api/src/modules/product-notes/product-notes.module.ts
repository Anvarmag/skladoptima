import { Module } from '@nestjs/common';
import { ProductNotesController } from './product-notes.controller';
import { ProductNotesCountController } from './product-notes-count.controller';
import { ProductNotesService } from './product-notes.service';

@Module({
    controllers: [ProductNotesCountController, ProductNotesController],
    providers: [ProductNotesService],
    exports: [ProductNotesService],
})
export class ProductNotesModule {}
