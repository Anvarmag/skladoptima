process.env.IS_WORKER = 'true';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    // ApplicationContext only — no HTTP server, no port binding.
    // WorkerRuntimeService.onApplicationBootstrap() starts the polling loop
    // when IS_WORKER=true (set above before module initialization).
    const app = await NestFactory.createApplicationContext(AppModule);

    // Register SIGTERM/SIGINT handlers so NestJS can trigger
    // OnApplicationShutdown hooks (graceful lease release + job recovery).
    app.enableShutdownHooks();

    console.log(`Worker started (pid=${process.pid})`);
}

bootstrap().catch((err) => {
    console.error('Worker bootstrap failed', err);
    process.exit(1);
});
