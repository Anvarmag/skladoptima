import { IsUUID } from 'class-validator';

export class ReplaceFileDto {
    @IsUUID()
    newFileId: string;
}
