import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

function buildAllowedOrigins() {
  const isProd = process.env.NODE_ENV === 'production';

  // PROD: строго по env, можно через запятую
  const prodList = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // DEV: localhost/127.0.0.1 с любым портом
  const devRegex = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  return { isProd, prodList, devRegex };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());

  app.setGlobalPrefix('api');

  const { isProd, prodList, devRegex } = buildAllowedOrigins();

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // same-origin / server-to-server запросы (nginx reverse proxy) — всегда разрешаем
      if (!origin) return callback(null, true);

      if (!isProd) {
        // DEV: разрешаем localhost/127.0.0.1 на любом порту
        return callback(null, devRegex.test(origin));
      }

      // PROD: если CORS_ORIGIN не задан — разрешаем все (nginx уже проксирует)
      if (prodList.length === 0) return callback(null, true);

      // PROD: только whitelisted домены
      return callback(null, prodList.includes(origin));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(
    `[Sklad Optima] API running on port ${port} (${isProd ? 'production' : 'development'})`,
  );
}

bootstrap();