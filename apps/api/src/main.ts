import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());

  app.setGlobalPrefix('api');

  // ── CORS ──────────────────────────────────────────────────────────────────
  // In prod, set CORS_ORIGIN to your exact frontend domain (no trailing slash).
  // In dev, falls back to localhost:5173.
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = isProd
    ? (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:3000'];

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  });

  // ── Validation ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`[Sklad Optima] API running on port ${port} (${isProd ? 'production' : 'development'})`);
}
bootstrap();
