import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { StorageConfig } from '../config/configuration';
import { S3_CLIENT, STORAGE_CONFIG } from './storage.constants';
import { StorageService } from './storage.service';

const storageConfig: StorageConfig = {
  region: 'ap-southeast-1',
  bucket: 'my-bucket',
  publicUrl: 'https://my-bucket.s3.ap-southeast-1.amazonaws.com',
};

describe('StorageService', () => {
  let service: StorageService;
  let send: jest.Mock;

  beforeEach(async () => {
    send = jest.fn().mockResolvedValue({});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useValue: { send } as unknown as S3Client },
        { provide: STORAGE_CONFIG, useValue: storageConfig },
      ],
    }).compile();

    service = moduleRef.get(StorageService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('putObject', () => {
    it('gửi PutObjectCommand đúng bucket/key/contentType và trả về public URL', async () => {
      const url = await service.putObject({
        key: 'users/1/avatar.jpg',
        body: Buffer.from('data'),
        contentType: 'image/jpeg',
      });

      expect(url).toBe('https://my-bucket.s3.ap-southeast-1.amazonaws.com/users/1/avatar.jpg');
      expect(send).toHaveBeenCalledTimes(1);

      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'my-bucket',
        Key: 'users/1/avatar.jpg',
        ContentType: 'image/jpeg',
      });
    });

    it('ném InternalServerErrorException khi S3 lỗi', async () => {
      send.mockRejectedValue(new Error('AccessDenied'));

      await expect(
        service.putObject({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('deleteObjectQuietly', () => {
    it('gửi DeleteObjectCommand với đúng key', async () => {
      await service.deleteObjectQuietly('users/1/avatar.png');

      const command = send.mock.calls[0][0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toMatchObject({ Bucket: 'my-bucket', Key: 'users/1/avatar.png' });
    });

    it('không ném lỗi khi S3 xoá thất bại', async () => {
      send.mockRejectedValue(new Error('NoSuchKey'));

      await expect(service.deleteObjectQuietly('missing')).resolves.toBeUndefined();
    });
  });

  describe('resolveKeyFromUrl', () => {
    it('trả về key khi URL thuộc bucket đang cấu hình', () => {
      expect(
        service.resolveKeyFromUrl(
          'https://my-bucket.s3.ap-southeast-1.amazonaws.com/users/9/avatar.webp',
        ),
      ).toBe('users/9/avatar.webp');
    });

    it('trả về null khi URL trỏ tới nơi khác', () => {
      expect(service.resolveKeyFromUrl('https://example.com/users/9/avatar.webp')).toBeNull();
    });
  });
});
