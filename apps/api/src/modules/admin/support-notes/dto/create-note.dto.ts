import { IsString, MinLength, MaxLength } from 'class-validator';

/// Internal note для handoff между сменами поддержки.
/// 4000 — soft cap; tenant 360 показывает только последние N нот, длинные
/// payload'ы попадают в external incident-tooling (см. §20).
export class CreateSupportNoteDto {
    @IsString()
    @MinLength(1)
    @MaxLength(4000)
    note: string;
}
