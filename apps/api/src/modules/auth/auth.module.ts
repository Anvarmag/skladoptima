import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { EmailService } from './email.service';
import { CsrfService } from './csrf.service';
import { CsrfGuard } from './csrf.guard';
import { UserModule } from '../users/user.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
    imports: [
        UserModule,
        OnboardingModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'super-secret-key-change-me',
            signOptions: { expiresIn: '15m' },
        }),
    ],
    providers: [AuthService, JwtStrategy, EmailService, CsrfService, CsrfGuard],
    controllers: [AuthController],
    exports: [AuthService, CsrfService, CsrfGuard, EmailService],
})
export class AuthModule {}
