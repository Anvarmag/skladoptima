import axios from 'axios';

export type LockType = 'ZERO' | 'FIXED' | 'PAUSED';
export type Marketplace = 'WB' | 'OZON';

export interface StockLock {
    id: string;
    productId: string;
    marketplace: Marketplace;
    lockType: LockType;
    fixedValue: number | null;
    note: string | null;
    createdAt: string;
}

export interface CreateLockPayload {
    productId: string;
    marketplace: Marketplace;
    lockType: LockType;
    fixedValue?: number | null;
    note?: string | null;
}

export async function fetchLocksForTenant(): Promise<StockLock[]> {
    const res = await axios.get('/stock-locks');
    return res.data.data ?? [];
}

export async function fetchLocksForProduct(productId: string): Promise<StockLock[]> {
    const res = await axios.get('/stock-locks', { params: { productId } });
    return res.data.data ?? [];
}

export async function createLock(payload: CreateLockPayload): Promise<StockLock> {
    const res = await axios.post('/stock-locks', payload);
    return res.data;
}

export async function removeLock(lockId: string): Promise<void> {
    await axios.delete(`/stock-locks/${lockId}`);
}
