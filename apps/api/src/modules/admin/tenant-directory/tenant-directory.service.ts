import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ListTenantsDto } from './dto/list-tenants.dto';

const DEFAULT_LIMIT = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantDirectoryRow {
    id: string;
    name: string;
    inn: string | null;
    status: string;
    accessState: string;
    closedAt: Date | null;
    createdAt: Date;
    primaryOwner: { id: string; email: string } | null;
    teamSize: number;
    marketplaceAccountsActive: number;
}

export interface TenantDirectoryPage {
    items: TenantDirectoryRow[];
    nextCursor: string | null;
    total: number;
}

/// Tenant directory read-model. По задаче §18 carry — endpoint должен быть
/// быстрым и safe-by-default: bounded limit, единый bounded набор полей,
/// никаких ad hoc joins по тяжёлым таблицам.
///
/// Поиск `q`:
///   • если строка — UUID, ищем точное совпадение по `tenant.id` (быстрый
///     short-circuit без LIKE);
///   • иначе ILIKE по `tenant.name` ИЛИ по `primaryOwner.email`.
///
/// Cursor — opaque base64(JSON({createdAt, id})), keyset-pagination по
/// `(createdAt DESC, id DESC)` — чтобы не платить OFFSET-пагинацией.
@Injectable()
export class TenantDirectoryService {
    constructor(private readonly prisma: PrismaService) {}

    async list(dto: ListTenantsDto): Promise<TenantDirectoryPage> {
        const limit = dto.limit ?? DEFAULT_LIMIT;
        const where = this.buildWhere(dto);
        const cursor = this.decodeCursor(dto.cursor);

        const [items, total] = await this.prisma.$transaction([
            this.prisma.tenant.findMany({
                where: cursor
                    ? {
                          AND: [
                              where,
                              {
                                  OR: [
                                      { createdAt: { lt: cursor.createdAt } },
                                      {
                                          AND: [
                                              { createdAt: cursor.createdAt },
                                              { id: { lt: cursor.id } },
                                          ],
                                      },
                                  ],
                              },
                          ],
                      }
                    : where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                select: {
                    id: true,
                    name: true,
                    inn: true,
                    status: true,
                    accessState: true,
                    closedAt: true,
                    createdAt: true,
                    primaryOwner: { select: { id: true, email: true } },
                    _count: {
                        select: {
                            memberships: { where: { status: 'ACTIVE' } },
                            marketplaceAccounts: { where: { lifecycleStatus: 'ACTIVE' } },
                        },
                    },
                },
            }),
            this.prisma.tenant.count({ where }),
        ]);

        const hasMore = items.length > limit;
        const sliced = hasMore ? items.slice(0, limit) : items;
        const last = sliced[sliced.length - 1];

        return {
            items: sliced.map<TenantDirectoryRow>((t) => ({
                id: t.id,
                name: t.name,
                inn: t.inn,
                status: t.status,
                accessState: t.accessState,
                closedAt: t.closedAt,
                createdAt: t.createdAt,
                primaryOwner: t.primaryOwner
                    ? { id: t.primaryOwner.id, email: t.primaryOwner.email }
                    : null,
                teamSize: t._count.memberships,
                marketplaceAccountsActive: t._count.marketplaceAccounts,
            })),
            nextCursor: hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
            total,
        };
    }

    private buildWhere(dto: ListTenantsDto): Prisma.TenantWhereInput {
        const filters: Prisma.TenantWhereInput[] = [];

        if (dto.status) filters.push({ status: dto.status });
        if (dto.accessState) filters.push({ accessState: dto.accessState });

        if (dto.q && dto.q.trim()) {
            const q = dto.q.trim();
            if (UUID_RE.test(q)) {
                filters.push({ id: q });
            } else {
                filters.push({
                    OR: [
                        { name: { contains: q, mode: 'insensitive' } },
                        { primaryOwner: { email: { contains: q, mode: 'insensitive' } } },
                    ],
                });
            }
        }

        return filters.length > 0 ? { AND: filters } : {};
    }

    private encodeCursor(createdAt: Date, id: string): string {
        return Buffer.from(JSON.stringify({ c: createdAt.toISOString(), i: id })).toString(
            'base64url',
        );
    }

    private decodeCursor(raw?: string): { createdAt: Date; id: string } | null {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
                c: string;
                i: string;
            };
            const date = new Date(parsed.c);
            if (Number.isNaN(date.getTime()) || typeof parsed.i !== 'string') return null;
            return { createdAt: date, id: parsed.i };
        } catch {
            return null;
        }
    }
}
