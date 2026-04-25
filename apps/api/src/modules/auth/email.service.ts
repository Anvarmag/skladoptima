import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    async sendVerificationEmail(email: string, token: string): Promise<void> {
        const verifyUrl = `${process.env.APP_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
        // TODO T1-30: replace with real email provider (SendGrid / Postmark / Mailgun)
        this.logger.log(`[DEV] Verification email → ${email} | URL: ${verifyUrl}`);
    }

    async sendPasswordResetEmail(email: string, token: string): Promise<void> {
        const resetUrl = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
        // TODO T1-30: replace with real email provider
        this.logger.log(`[DEV] Password reset email → ${email} | URL: ${resetUrl}`);
    }
}
