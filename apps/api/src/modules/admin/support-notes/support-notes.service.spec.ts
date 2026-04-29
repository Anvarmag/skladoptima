/**
 * TASK_ADMIN_7: regression suite для `SupportNotesService`.
 *
 * Покрывает §16 матрицу:
 *   - list по tenant'у — без полей IP/UA/correlationId оператора;
 *   - create — пишет support_note + делегирует actions.recordNoteAdded;
 *   - tenant-not-found = ADMIN_TENANT_NOT_FOUND.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
}));

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { SupportActionsService } from '../support-actions/support-actions.service';
import { SupportNotesService } from './support-notes.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const ACTOR = {
    id: 'su-1',
    email: 'support@example.com',
    role: 'SUPPORT_ADMIN' as const,
    sessionId: 'sess-1',
};

describe('SupportNotesService', () => {
    let service: SupportNotesService;
    let prisma: any;
    let actions: { recordNoteAdded: jest.Mock };

    beforeEach(async () => {
        prisma = {
            tenant: { findUnique: jest.fn() },
            supportNote: { findMany: jest.fn(), create: jest.fn() },
        };
        actions = {
            recordNoteAdded: jest.fn().mockResolvedValue({ auditLogId: 'audit-x' }),
        };

        const module = await Test.createTestingModule({
            providers: [
                SupportNotesService,
                { provide: PrismaService, useValue: prisma },
                { provide: SupportActionsService, useValue: actions },
            ],
        }).compile();

        service = module.get(SupportNotesService);
    });

    describe('list', () => {
        it('возвращает только публичные поля автора (id/email/role) — без IP/UA', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            prisma.supportNote.findMany.mockResolvedValue([
                {
                    id: 'n1',
                    note: 'first incident',
                    createdAt: new Date('2026-04-29'),
                    updatedAt: new Date('2026-04-29'),
                    authorSupportUser: {
                        id: 'su-2',
                        email: 'op2@example.com',
                        role: 'SUPPORT_ADMIN',
                    },
                },
            ]);

            const out = await service.list(TENANT_ID);

            expect(out.items).toHaveLength(1);
            const item = out.items[0] as any;
            expect(item.author).toEqual({
                id: 'su-2',
                email: 'op2@example.com',
                role: 'SUPPORT_ADMIN',
            });
            // Инвариант §15 / TASK_ADMIN_4: notes наружу не отдают IP/UA/correlationId
            // оператора.
            expect(item.ip).toBeUndefined();
            expect(item.userAgent).toBeUndefined();
            expect(item.correlationId).toBeUndefined();
        });

        it('tenant-not-found = ADMIN_TENANT_NOT_FOUND', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            await expect(service.list(TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('create', () => {
        it('пишет note + вызывает recordNoteAdded для audit/journal', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            prisma.supportNote.create.mockResolvedValue({
                id: 'n1',
                note: 'incident handoff',
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const out = await service.create(TENANT_ID, 'incident handoff', ACTOR, {
                ip: '10.0.0.1',
                userAgent: 'jest',
                correlationId: 'corr-1',
            });

            expect(prisma.supportNote.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenantId: TENANT_ID,
                        authorSupportUserId: 'su-1',
                        note: 'incident handoff',
                    }),
                }),
            );
            expect(actions.recordNoteAdded).toHaveBeenCalledWith(
                TENANT_ID,
                'n1',
                expect.objectContaining({
                    actor: ACTOR,
                    correlationId: 'corr-1',
                }),
            );
            expect(out.auditLogId).toBe('audit-x');
        });

        it('tenant-not-found = ADMIN_TENANT_NOT_FOUND', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            await expect(
                service.create(TENANT_ID, 'note', ACTOR, {
                    ip: null,
                    userAgent: null,
                    correlationId: null,
                }),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(actions.recordNoteAdded).not.toHaveBeenCalled();
        });
    });
});
