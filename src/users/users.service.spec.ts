import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PaginatedResult } from '../common/dto/api-response';
import { StorageService } from '../storage/storage.service';
import { User } from './entities/user.entity';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  name: 'Nguyen Van A',
  email: 'a@example.com',
  avatarUrl: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const buildFile = (buffer: Buffer): Express.Multer.File =>
  ({
    buffer,
    originalname: 'avatar.png',
    mimetype: 'image/png',
    size: buffer.length,
  }) as Express.Multer.File;

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: jest.Mocked<UsersRepository>;
  let storageService: jest.Mocked<StorageService>;

  beforeEach(async () => {
    usersRepository = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    storageService = {
      putObject: jest.fn(),
      deleteObjectQuietly: jest.fn().mockResolvedValue(undefined),
      resolveKeyFromUrl: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('tạo user mới khi email chưa tồn tại', async () => {
      // Arrange
      const dto = { name: 'Nguyen Van A', email: 'a@example.com' };
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockResolvedValue(buildUser());

      // Act
      const result = await service.create(dto);

      // Assert
      expect(usersRepository.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        id: 1,
        name: 'Nguyen Van A',
        email: 'a@example.com',
        avatarUrl: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('ném ConflictException khi email đã tồn tại', async () => {
      usersRepository.findByEmail.mockResolvedValue(buildUser());

      await expect(service.create({ name: 'B', email: 'a@example.com' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(usersRepository.create).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi unique index bắt được race condition', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockRejectedValue(
        Object.assign(new Error('duplicate'), { driverError: { code: 'ER_DUP_ENTRY' } }),
      );

      await expect(service.create({ name: 'B', email: 'a@example.com' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('ném lại lỗi không phải trùng email', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.create({ name: 'B', email: 'b@example.com' })).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });

  describe('findAll', () => {
    it('trả về PaginatedResult kèm metadata phân trang', async () => {
      usersRepository.findAll.mockResolvedValue([[buildUser(), buildUser({ id: 2 })], 25]);

      const result = await service.findAll({ page: 2, limit: 10 });

      expect(result).toBeInstanceOf(PaginatedResult);
      expect(result.items).toHaveLength(2);
      expect(result.meta).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
      expect(usersRepository.findAll).toHaveBeenCalledWith({ page: 2, limit: 10 });
    });
  });

  describe('findOne', () => {
    it('trả về user khi tồn tại', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());

      await expect(service.findOne(1)).resolves.toMatchObject({ id: 1 });
    });

    it('ném NotFoundException khi user không tồn tại', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await expect(service.findOne(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('cập nhật user và trả về bản ghi mới', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());
      usersRepository.update.mockResolvedValue(buildUser({ name: 'Tran Van B' }));

      const result = await service.update(1, { name: 'Tran Van B' });

      expect(result.name).toBe('Tran Van B');
      expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi đổi sang email đã có người dùng', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());
      usersRepository.findByEmail.mockResolvedValue(buildUser({ id: 2, email: 'b@example.com' }));

      await expect(service.update(1, { email: 'b@example.com' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('không kiểm tra trùng khi email giữ nguyên', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());
      usersRepository.update.mockResolvedValue(buildUser());

      await service.update(1, { email: 'a@example.com' });

      expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi bản ghi biến mất giữa chừng', async () => {
      usersRepository.findById.mockResolvedValueOnce(buildUser());
      usersRepository.update.mockResolvedValue(null);

      await expect(service.update(1, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ném NotFoundException khi user không tồn tại', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await expect(service.update(9, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('xoá user và dọn luôn avatar trên S3', async () => {
      usersRepository.findById.mockResolvedValue(
        buildUser({ avatarUrl: 'https://cdn.test/users/1/avatar.png' }),
      );
      usersRepository.delete.mockResolvedValue(true);
      storageService.resolveKeyFromUrl.mockReturnValue('users/1/avatar.png');

      await service.remove(1);

      expect(usersRepository.delete).toHaveBeenCalledWith(1);
      expect(storageService.deleteObjectQuietly).toHaveBeenCalledWith('users/1/avatar.png');
    });

    it('bỏ qua bước xoá S3 khi user chưa có avatar', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());
      usersRepository.delete.mockResolvedValue(true);

      await service.remove(1);

      expect(storageService.deleteObjectQuietly).not.toHaveBeenCalled();
    });

    it('bỏ qua bước xoá S3 khi avatar URL nằm ngoài bucket', async () => {
      usersRepository.findById.mockResolvedValue(
        buildUser({ avatarUrl: 'https://other.example.com/a.png' }),
      );
      usersRepository.delete.mockResolvedValue(true);
      storageService.resolveKeyFromUrl.mockReturnValue(null);

      await service.remove(1);

      expect(storageService.deleteObjectQuietly).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi user không tồn tại', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await expect(service.remove(9)).rejects.toBeInstanceOf(NotFoundException);
      expect(usersRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateAvatar', () => {
    it('upload lên S3 rồi lưu avatar URL vào DB', async () => {
      const uploadedUrl = 'https://cdn.test/users/1/avatar.png';
      usersRepository.findById.mockResolvedValue(buildUser());
      storageService.putObject.mockResolvedValue(uploadedUrl);
      usersRepository.update.mockResolvedValue(buildUser({ avatarUrl: uploadedUrl }));

      const result = await service.updateAvatar(1, buildFile(PNG_BYTES));

      expect(storageService.putObject).toHaveBeenCalledWith({
        key: 'users/1/avatar.png',
        body: PNG_BYTES,
        contentType: 'image/png',
      });
      expect(usersRepository.update).toHaveBeenCalledWith(1, { avatarUrl: uploadedUrl });
      expect(result.avatarUrl).toBe(uploadedUrl);
    });

    it('xoá avatar cũ khi định dạng file thay đổi', async () => {
      const oldUrl = 'https://cdn.test/users/1/avatar.png';
      const newUrl = 'https://cdn.test/users/1/avatar.jpg';
      usersRepository.findById.mockResolvedValue(buildUser({ avatarUrl: oldUrl }));
      storageService.putObject.mockResolvedValue(newUrl);
      usersRepository.update.mockResolvedValue(buildUser({ avatarUrl: newUrl }));
      storageService.resolveKeyFromUrl.mockReturnValue('users/1/avatar.png');

      await service.updateAvatar(1, buildFile(JPEG_BYTES));

      expect(storageService.deleteObjectQuietly).toHaveBeenCalledWith('users/1/avatar.png');
    });

    it('không xoá gì khi ghi đè lên đúng key cũ', async () => {
      const sameUrl = 'https://cdn.test/users/1/avatar.png';
      usersRepository.findById.mockResolvedValue(buildUser({ avatarUrl: sameUrl }));
      storageService.putObject.mockResolvedValue(sameUrl);
      usersRepository.update.mockResolvedValue(buildUser({ avatarUrl: sameUrl }));

      await service.updateAvatar(1, buildFile(PNG_BYTES));

      expect(storageService.deleteObjectQuietly).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi thiếu file', async () => {
      await expect(service.updateAvatar(1, undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ném BadRequestException khi file rỗng', async () => {
      await expect(service.updateAvatar(1, buildFile(Buffer.alloc(0)))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('từ chối file không phải ảnh dù client khai mimetype là image/png', async () => {
      await expect(
        service.updateAvatar(1, buildFile(Buffer.from('#!/bin/sh\nrm -rf /'))),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageService.putObject).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi user không tồn tại', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await expect(service.updateAvatar(9, buildFile(PNG_BYTES))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storageService.putObject).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi user bị xoá ngay sau khi upload', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());
      storageService.putObject.mockResolvedValue('https://cdn.test/users/1/avatar.png');
      usersRepository.update.mockResolvedValue(null);

      await expect(service.updateAvatar(1, buildFile(PNG_BYTES))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
