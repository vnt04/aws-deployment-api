import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StorageConfig } from '../config/configuration';
import { S3_CLIENT, STORAGE_CONFIG } from './storage.constants';
import { StorageService } from './storage.service';

const storageConfigProvider = {
  provide: STORAGE_CONFIG,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): StorageConfig =>
    configService.getOrThrow<StorageConfig>('storage'),
};

const s3ClientProvider = {
  provide: S3_CLIENT,
  inject: [STORAGE_CONFIG],
  useFactory: (config: StorageConfig): S3Client =>
    new S3Client({
      region: config.region,
      // Không set credentials -> SDK tự lấy từ IAM Role của EC2 (instance metadata).
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
      // S3-compatible local (MinIO/LocalStack) chỉ hoạt động với path-style addressing.
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    }),
};

@Global()
@Module({
  providers: [storageConfigProvider, s3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
