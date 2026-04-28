import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Управление публичными referral-ссылками владельцев (TASK_REFERRALS_1).
 *
 * §6 контракт MVP: одна активная ссылка на `(ownerUserId, tenantId)`.
 * `getOrCreateForOwner` идемпотентен через UNIQUE — повторный вызов
 * возвращает существующую ссылку без exception'ов и без новых записей.
 *
 * `code` генерируется как 8-символьный crockford-base32 токен. Коллизия
 * чрезвычайно маловероятна (~1e12 пространство), но мы явно retry'им до
 * 5 раз на UNIQUE violation, чтобы не падать при экстремальном
 * совпадении.
 */

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // crockford
const CODE_LENGTH = 8;
const CODE_RETRY_LIMIT = 5;

export interface ReferralLinkDto {
    id: string;
    code: string;
    isActive: boolean;
    createdAt: string;
}

@Injectable()
export class ReferralLinkService {
    private readonly logger = new Logger(ReferralLinkService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Возвращает активную ссылку владельца для tenant, создаёт если нет.
     * UNIQUE(ownerUserId, tenantId) гарантирует, что параллельные вызовы
     * сходятся к одной записи — race-condition-safe.
     */
    async getOrCreateForOwner(args: {
        ownerUserId: string;
        tenantId: string;
    }): Promise<ReferralLinkDto> {
        const existing = await this.prisma.referralLink.findUnique({
            where: {
                ownerUserId_tenantId: {
                    ownerUserId: args.ownerUserId,
                    tenantId: args.tenantId,
                },
            },
        });
        if (existing) return this._toDto(existing);

        for (let attempt = 0; attempt < CODE_RETRY_LIMIT; attempt++) {
            const code = generateCode();
            try {
                const created = await this.prisma.referralLink.create({
                    data: {
                        ownerUserId: args.ownerUserId,
                        tenantId: args.tenantId,
                        code,
                        isActive: true,
                    },
                });
                this.logger.log(
                    `referral link created owner=${args.ownerUserId} tenant=${args.tenantId} code=${code}`,
                );
                return this._toDto(created);
            } catch (err: any) {
                // P2002 unique violation — на code или на (owner, tenant).
                if (err?.code === 'P2002') {
                    // Если владелец-комбинация уже существует (race) — читаем
                    // и возвращаем существующую.
                    const concurrent = await this.prisma.referralLink.findUnique({
                        where: {
                            ownerUserId_tenantId: {
                                ownerUserId: args.ownerUserId,
                                tenantId: args.tenantId,
                            },
                        },
                    });
                    if (concurrent) return this._toDto(concurrent);
                    // Иначе — это коллизия code, retry.
                    continue;
                }
                throw err;
            }
        }
        throw new Error('failed to generate unique referral code after retries');
    }

    /**
     * Поиск ссылки по публичному коду — нужно при регистрации, чтобы
     * привязать `referralLinkId` к attribution. Возвращает null если код
     * не найден или неактивен.
     */
    async findActiveByCode(code: string) {
        if (!code) return null;
        const normalized = code.trim().toUpperCase();
        if (!normalized) return null;
        const link = await this.prisma.referralLink.findUnique({
            where: { code: normalized },
            select: { id: true, code: true, ownerUserId: true, tenantId: true, isActive: true },
        });
        if (!link || !link.isActive) return null;
        return link;
    }

    /**
     * Internal: используется attribution service'ом для проверки, что
     * код реально валидный. Public read API доступен через `findActiveByCode`.
     */
    async getByCodeOrThrow(code: string) {
        const link = await this.findActiveByCode(code);
        if (!link) {
            throw new NotFoundException({
                code: 'REFERRAL_CODE_NOT_FOUND',
                message: `referral code ${code} not found or inactive`,
            });
        }
        return link;
    }

    private _toDto(link: { id: string; code: string; isActive: boolean; createdAt: Date }): ReferralLinkDto {
        return {
            id: link.id,
            code: link.code,
            isActive: link.isActive,
            createdAt: link.createdAt.toISOString(),
        };
    }
}

function generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let s = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return s;
}
