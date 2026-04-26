import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CsrfService {
    generateToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    // Timing-safe comparison — prevents timing attacks on token comparison
    validateToken(cookieToken: string | undefined, headerToken: string | undefined): boolean {
        if (!cookieToken || !headerToken) return false;
        try {
            const a = Buffer.from(cookieToken);
            const b = Buffer.from(headerToken);
            if (a.length !== b.length) return false;
            return crypto.timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }
}
