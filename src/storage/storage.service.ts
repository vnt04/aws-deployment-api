import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

import { StorageConfig } from '../config/configuration';
import { S3_CLIENT, STORAGE_CONFIG } from './storage.constants';

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
  ) {}

  async putObject({ key, body, contentType }: PutObjectInput): Promise<string> {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      this.logger.error(`Upload S3 thất bại: ${key}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Không thể upload file lên S3');
    }

    return `${this.config.publicUrl}/${key}`;
  }

  /** Xoá file cũ là thao tác dọn dẹp — lỗi ở đây không được làm hỏng request chính. */
  async deleteObjectQuietly(key: string): Promise<void> {
    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (error) {
      this.logger.warn(
        `Xoá object S3 thất bại: ${key}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  resolveKeyFromUrl(url: string): string | null {
    const prefix = `${this.config.publicUrl}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
