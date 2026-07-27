import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const { port, corsOrigins } = app.get(ConfigService).getOrThrow<AppConfig>('app');

  // Nginx là reverse proxy duy nhất phía trước, cần trust proxy để rate limit đọc đúng client IP.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  Logger.log(`API đang chạy tại ${await app.getUrl()}`, 'Bootstrap');
}

void bootstrap();
