import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { StorageService } from '../src/storage/storage.service';
import { UsersController } from '../src/users/users.controller';
import { UsersRepository } from '../src/users/users.repository';
import { UsersService } from '../src/users/users.service';
import { FakeStorageService, FakeUsersRepository } from './fakes';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

describe('Users API (e2e)', () => {
  let app: INestApplication;
  let storage: FakeStorageService;

  const createUser = (payload: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/users').send(payload);

  beforeEach(async () => {
    storage = new FakeStorageService();

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: new FakeUsersRepository() },
        { provide: StorageService, useValue: storage },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /users', () => {
    it('tạo user mới và trả về envelope thành công', async () => {
      const response = await createUser({ name: 'Nguyen Van A', email: 'a@example.com' }).expect(
        201,
      );

      expect(response.body).toEqual({
        success: true,
        error: null,
        data: {
          id: 1,
          name: 'Nguyen Van A',
          email: 'a@example.com',
          avatarUrl: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });
    });

    it('trả 400 kèm chi tiết lỗi khi payload sai', async () => {
      const response = await createUser({ name: '', email: 'khong-phai-email' }).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.details.length).toBeGreaterThan(0);
    });

    it('trả 400 khi gửi field lạ', async () => {
      await createUser({ name: 'A', email: 'a@example.com', role: 'admin' }).expect(400);
    });

    it('trả 409 khi email đã tồn tại', async () => {
      await createUser({ name: 'A', email: 'a@example.com' }).expect(201);

      const response = await createUser({ name: 'B', email: 'A@Example.com' }).expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('GET /users', () => {
    it('trả về danh sách kèm meta phân trang', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });
      await createUser({ name: 'B', email: 'b@example.com' });

      const response = await request(app.getHttpServer())
        .get('/users')
        .query({ page: 1, limit: 1 })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2 });
    });

    it('trả 400 khi limit vượt trần cho phép', async () => {
      await request(app.getHttpServer()).get('/users').query({ limit: 1000 }).expect(400);
    });
  });

  describe('GET /users/:id', () => {
    it('trả về user theo id', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });

      const response = await request(app.getHttpServer()).get('/users/1').expect(200);

      expect(response.body.data.email).toBe('a@example.com');
    });

    it('trả 404 khi user không tồn tại', async () => {
      const response = await request(app.getHttpServer()).get('/users/999').expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('trả 400 khi id không phải số', async () => {
      await request(app.getHttpServer()).get('/users/abc').expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('cập nhật một phần thông tin', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });

      const response = await request(app.getHttpServer())
        .patch('/users/1')
        .send({ name: 'Tran Van B' })
        .expect(200);

      expect(response.body.data).toMatchObject({ name: 'Tran Van B', email: 'a@example.com' });
    });

    it('trả 409 khi đổi sang email của user khác', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });
      await createUser({ name: 'B', email: 'b@example.com' });

      await request(app.getHttpServer())
        .patch('/users/2')
        .send({ email: 'a@example.com' })
        .expect(409);
    });
  });

  describe('DELETE /users/:id', () => {
    it('xoá user và trả 204', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });

      await request(app.getHttpServer()).delete('/users/1').expect(204);
      await request(app.getHttpServer()).get('/users/1').expect(404);
    });

    it('trả 404 khi xoá user không tồn tại', async () => {
      await request(app.getHttpServer()).delete('/users/999').expect(404);
    });
  });

  describe('POST /users/:id/avatar', () => {
    it('upload ảnh lên storage và lưu avatarUrl vào user', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });

      const response = await request(app.getHttpServer())
        .post('/users/1/avatar')
        .attach('avatar', PNG_BYTES, { filename: 'me.png', contentType: 'image/png' })
        .expect(201);

      expect(response.body.data.avatarUrl).toBe(
        'https://test-bucket.s3.ap-southeast-1.amazonaws.com/users/1/avatar.png',
      );
      expect(storage.objects.has('users/1/avatar.png')).toBe(true);
    });

    it('xoá file cũ khi upload ảnh định dạng khác', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });
      await request(app.getHttpServer())
        .post('/users/1/avatar')
        .attach('avatar', PNG_BYTES, { filename: 'me.png', contentType: 'image/png' });

      await request(app.getHttpServer())
        .post('/users/1/avatar')
        .attach('avatar', JPEG_BYTES, { filename: 'me.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(storage.deletedKeys).toEqual(['users/1/avatar.png']);
      expect(storage.objects.has('users/1/avatar.jpg')).toBe(true);
    });

    it('từ chối file không phải ảnh dù client khai contentType là image/png', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });

      const response = await request(app.getHttpServer())
        .post('/users/1/avatar')
        .attach('avatar', Buffer.from('#!/bin/sh\nrm -rf /'), {
          filename: 'payload.png',
          contentType: 'image/png',
        })
        .expect(400);

      expect(response.body.error.message).toMatch(/JPEG, PNG hoặc WEBP/);
      expect(storage.objects.size).toBe(0);
    });

    it('trả 400 khi không đính kèm file', async () => {
      await createUser({ name: 'A', email: 'a@example.com' });

      await request(app.getHttpServer()).post('/users/1/avatar').expect(400);
    });

    it('trả 404 khi user không tồn tại', async () => {
      await request(app.getHttpServer())
        .post('/users/999/avatar')
        .attach('avatar', PNG_BYTES, { filename: 'me.png', contentType: 'image/png' })
        .expect(404);
    });
  });
});
