process.env.IS_WORKER = 'true';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    // В отличие от основного main.ts, мы не слушаем HTTP-порт!
    // Мы создаем только ApplicationContext для инициализации DI, CRON-задач и сервисов.
    const app = await NestFactory.createApplicationContext(AppModule);
    
    console.log('🚀 Worker Microservice successfully started (Background Tasks Only)');
}

bootstrap();
