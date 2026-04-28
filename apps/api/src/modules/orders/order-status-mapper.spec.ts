/**
 * TASK_ORDERS_7: regression spec для `OrderStatusMapperService` —
 * чистая логика без БД и mock'ов. Проверяем три инварианта:
 *   1) маппинг WB/Ozon статусов соответствует §13 (RESERVED/CANCELLED/
 *      FULFILLED + INTERMEDIATE для PACKED/SHIPPED-аналогов и unknown);
 *   2) FBO всегда INTERMEDIATE на mapper-уровне;
 *   3) state machine guard защищает терминальные статусы от silent
 *      overwrite (§20 риск).
 */

jest.mock('@prisma/client', () => ({
    MarketplaceType: { WB: 'WB', OZON: 'OZON' },
    OrderFulfillmentMode: { FBS: 'FBS', FBO: 'FBO' },
    OrderInternalStatus: {
        IMPORTED: 'IMPORTED',
        RESERVED: 'RESERVED',
        CANCELLED: 'CANCELLED',
        FULFILLED: 'FULFILLED',
        DISPLAY_ONLY_FBO: 'DISPLAY_ONLY_FBO',
        UNRESOLVED: 'UNRESOLVED',
    },
}));

import { OrderStatusMapperService } from './order-status-mapper.service';
import { OrderInternalStatus } from '@prisma/client';

const svc = new OrderStatusMapperService();

describe('OrderStatusMapperService — mapExternalToInternal', () => {
    it('WB: new → RESERVED', () => {
        expect(svc.mapExternalToInternal('WB' as any, 'new', 'FBS' as any)).toEqual({
            kind: 'TRANSITION', to: 'RESERVED',
        });
    });

    it('WB: confirm/sorted (PACKED-аналоги) → INTERMEDIATE', () => {
        expect(svc.mapExternalToInternal('WB' as any, 'confirm', 'FBS' as any)).toMatchObject({
            kind: 'INTERMEDIATE', reason: 'known_intermediate',
        });
        expect(svc.mapExternalToInternal('WB' as any, 'sorted', 'FBS' as any)).toMatchObject({
            kind: 'INTERMEDIATE',
        });
    });

    it('WB: sold/delivered → FULFILLED', () => {
        expect(svc.mapExternalToInternal('WB' as any, 'sold', 'FBS' as any).kind).toBe('TRANSITION');
        expect(svc.mapExternalToInternal('WB' as any, 'delivered', 'FBS' as any)).toEqual({
            kind: 'TRANSITION', to: 'FULFILLED',
        });
    });

    it('WB: canceled (любая раскладка) → CANCELLED', () => {
        for (const s of ['canceled', 'cancelled', 'canceled_by_client', 'declined_by_client', 'defect']) {
            expect(svc.mapExternalToInternal('WB' as any, s, 'FBS' as any)).toEqual({
                kind: 'TRANSITION', to: 'CANCELLED',
            });
        }
    });

    it('Ozon: awaiting_packaging → RESERVED', () => {
        expect(svc.mapExternalToInternal('OZON' as any, 'awaiting_packaging', 'FBS' as any)).toEqual({
            kind: 'TRANSITION', to: 'RESERVED',
        });
    });

    it('Ozon: delivering/sent_by_seller → INTERMEDIATE (SHIPPED-аналоги)', () => {
        for (const s of ['delivering', 'driver_pickup', 'sent_by_seller']) {
            expect(svc.mapExternalToInternal('OZON' as any, s, 'FBS' as any).kind).toBe('INTERMEDIATE');
        }
    });

    it('Ozon: delivered → FULFILLED, cancelled → CANCELLED', () => {
        expect(svc.mapExternalToInternal('OZON' as any, 'delivered', 'FBS' as any))
            .toEqual({ kind: 'TRANSITION', to: 'FULFILLED' });
        expect(svc.mapExternalToInternal('OZON' as any, 'cancelled', 'FBS' as any))
            .toEqual({ kind: 'TRANSITION', to: 'CANCELLED' });
        expect(svc.mapExternalToInternal('OZON' as any, 'not_accepted', 'FBS' as any))
            .toEqual({ kind: 'TRANSITION', to: 'CANCELLED' });
    });

    it('FBO заказ всегда INTERMEDIATE независимо от внешнего статуса (§13)', () => {
        for (const s of ['new', 'awaiting_packaging', 'delivered', 'cancelled']) {
            expect(svc.mapExternalToInternal('OZON' as any, s, 'FBO' as any).kind).toBe('INTERMEDIATE');
        }
    });

    it('Unknown статус → INTERMEDIATE с reason=unknown_status', () => {
        expect(svc.mapExternalToInternal('OZON' as any, 'totally_unknown', 'FBS' as any)).toEqual({
            kind: 'INTERMEDIATE', reason: 'unknown_status',
        });
        // null/undefined тоже unknown
        expect(svc.mapExternalToInternal('WB' as any, null, 'FBS' as any).kind).toBe('INTERMEDIATE');
    });

    it('Case-insensitive: NEW и New совпадают с new', () => {
        expect(svc.mapExternalToInternal('WB' as any, 'NEW', 'FBS' as any))
            .toEqual({ kind: 'TRANSITION', to: 'RESERVED' });
        expect(svc.mapExternalToInternal('WB' as any, 'New ', 'FBS' as any))
            .toEqual({ kind: 'TRANSITION', to: 'RESERVED' });
    });
});

describe('OrderStatusMapperService — resolveInitialStatus', () => {
    it('FBO → DISPLAY_ONLY_FBO даже если все matched и external=new', () => {
        expect(svc.resolveInitialStatus('OZON' as any, 'new', 'FBO' as any, true)).toBe('DISPLAY_ONLY_FBO');
    });

    it('FBS + unmatched items → UNRESOLVED (§14: scope не определён)', () => {
        expect(svc.resolveInitialStatus('WB' as any, 'new', 'FBS' as any, false)).toBe('UNRESOLVED');
    });

    it('FBS + matched + new → RESERVED (mapper применяется)', () => {
        expect(svc.resolveInitialStatus('WB' as any, 'new', 'FBS' as any, true)).toBe('RESERVED');
    });

    it('FBS + matched + intermediate external → IMPORTED fallback', () => {
        expect(svc.resolveInitialStatus('WB' as any, 'confirm', 'FBS' as any, true)).toBe('IMPORTED');
    });

    it('FBS + matched + unknown external → IMPORTED fallback', () => {
        expect(svc.resolveInitialStatus('OZON' as any, 'totally_unknown', 'FBS' as any, true)).toBe('IMPORTED');
    });
});

describe('OrderStatusMapperService — isTransitionAllowed (§13 state machine)', () => {
    it('Терминальные состояния НЕ покидаются (защита от silent overwrite §20)', () => {
        const terminal: OrderInternalStatus[] = ['CANCELLED' as any, 'FULFILLED' as any, 'DISPLAY_ONLY_FBO' as any];
        const targets: OrderInternalStatus[] = ['RESERVED' as any, 'IMPORTED' as any, 'UNRESOLVED' as any];
        for (const from of terminal) {
            for (const to of targets) {
                expect(svc.isTransitionAllowed(from, to)).toBe(false);
            }
        }
    });

    it('IMPORTED → RESERVED/CANCELLED/FULFILLED/UNRESOLVED разрешён', () => {
        for (const to of ['RESERVED', 'CANCELLED', 'FULFILLED', 'UNRESOLVED', 'DISPLAY_ONLY_FBO']) {
            expect(svc.isTransitionAllowed('IMPORTED' as any, to as any)).toBe(true);
        }
    });

    it('UNRESOLVED → RESERVED разрешён (recovery после resolve scope)', () => {
        expect(svc.isTransitionAllowed('UNRESOLVED' as any, 'RESERVED' as any)).toBe(true);
        expect(svc.isTransitionAllowed('UNRESOLVED' as any, 'CANCELLED' as any)).toBe(true);
    });

    it('RESERVED → CANCELLED/FULFILLED разрешён, RESERVED → IMPORTED — нет', () => {
        expect(svc.isTransitionAllowed('RESERVED' as any, 'CANCELLED' as any)).toBe(true);
        expect(svc.isTransitionAllowed('RESERVED' as any, 'FULFILLED' as any)).toBe(true);
        expect(svc.isTransitionAllowed('RESERVED' as any, 'IMPORTED' as any)).toBe(false);
    });

    it('No-op (from === to) считается разрешённым', () => {
        expect(svc.isTransitionAllowed('RESERVED' as any, 'RESERVED' as any)).toBe(true);
        expect(svc.isTransitionAllowed('CANCELLED' as any, 'CANCELLED' as any)).toBe(true);
    });
});
