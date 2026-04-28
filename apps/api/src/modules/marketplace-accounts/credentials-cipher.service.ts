import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Симметричное шифрование credentials для `MarketplaceCredential.encryptedPayload`.
 *
 * Алгоритм: AES-256-GCM. Формат payload в БД (Bytes):
 *   [12 bytes IV][16 bytes auth tag][N bytes ciphertext]
 *
 * Ключ берётся из ENV `MARKETPLACE_CREDENTIALS_KEY` (base64 32 bytes).
 * Версия ключа из ENV `MARKETPLACE_CREDENTIALS_KEY_VERSION` (int, default 1).
 * Это заземляет `MarketplaceCredential.encryptionKeyVersion` для будущей
 * key rotation: новые credentials шифруются текущей версией, старые читаются
 * старой через ENV-историю или vault (вне scope MVP).
 *
 * Decrypt-операции вызываются ТОЛЬКО adapter-слоем sync. API persistence
 * слой работает только с `maskedPreview`.
 */
@Injectable()
export class CredentialsCipher {
    private readonly logger = new Logger(CredentialsCipher.name);
    private readonly ALG = 'aes-256-gcm';
    private readonly IV_LEN = 12;
    private readonly TAG_LEN = 16;

    /** Возвращает ключ shifrования. Lazy чтобы тесты могли подменять ENV до первого вызова. */
    private getKey(): Buffer {
        const raw = process.env.MARKETPLACE_CREDENTIALS_KEY;
        if (!raw) {
            // В dev-окружении генерируем стабильный ключ из фиксированного сидa,
            // чтобы local разработка не падала. В production ENV обязателен.
            if (process.env.NODE_ENV === 'production') {
                throw new InternalServerErrorException({
                    code: 'MARKETPLACE_CREDENTIALS_KEY_MISSING',
                    message: 'MARKETPLACE_CREDENTIALS_KEY env is required in production',
                });
            }
            return crypto.createHash('sha256').update('dev-marketplace-credentials-key').digest();
        }
        const buf = Buffer.from(raw, 'base64');
        if (buf.length !== 32) {
            throw new InternalServerErrorException({
                code: 'MARKETPLACE_CREDENTIALS_KEY_INVALID',
                message: 'MARKETPLACE_CREDENTIALS_KEY must be 32 bytes (base64-encoded)',
            });
        }
        return buf;
    }

    getCurrentKeyVersion(): number {
        const v = parseInt(process.env.MARKETPLACE_CREDENTIALS_KEY_VERSION ?? '1', 10);
        return Number.isInteger(v) && v > 0 ? v : 1;
    }

    /**
     * Шифрует структурированный payload (объект) и возвращает Buffer для
     * сохранения в `encryptedPayload Bytes`.
     */
    encrypt(payload: Record<string, unknown>): Buffer {
        const key = this.getKey();
        const iv = crypto.randomBytes(this.IV_LEN);
        const cipher = crypto.createCipheriv(this.ALG, key, iv);
        const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
        const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, ct]);
    }

    /**
     * Дешифрует Buffer обратно в объект. Бросает InternalServerErrorException
     * на повреждённые данные / неверный ключ — это сигнал для оператора, что
     * key rotation/storage сломаны, а не пользовательская ошибка.
     */
    decrypt(blob: Buffer | Uint8Array): Record<string, unknown> {
        try {
            const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
            if (buf.length < this.IV_LEN + this.TAG_LEN + 1) {
                throw new Error('payload too short');
            }
            const iv = buf.subarray(0, this.IV_LEN);
            const tag = buf.subarray(this.IV_LEN, this.IV_LEN + this.TAG_LEN);
            const ct = buf.subarray(this.IV_LEN + this.TAG_LEN);
            const key = this.getKey();
            const decipher = crypto.createDecipheriv(this.ALG, key, iv);
            decipher.setAuthTag(tag);
            const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
            return JSON.parse(pt.toString('utf8'));
        } catch (err) {
            this.logger.error(JSON.stringify({
                event: 'marketplace_credentials_decrypt_failed',
                error: (err as Error).message,
            }));
            throw new InternalServerErrorException({
                code: 'MARKETPLACE_CREDENTIALS_DECRYPT_FAILED',
            });
        }
    }

    /**
     * Маскирует строковое значение для UI: показывает только последние 4
     * символа, остальное — `***`. Для пустого/короткого — целиком `***`.
     */
    maskValue(v: string | null | undefined): string | null {
        if (typeof v !== 'string' || v.length === 0) return null;
        if (v.length <= 4) return '***';
        return '***' + v.slice(-4);
    }
}
