import { Test } from '@nestjs/testing';

import { PaginatedResult } from '../common/dto/api-response';
import { UserResponse } from './dto/user-response.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const userResponse: UserResponse = {
  id: 1,
  name: 'Nguyen Van A',
  email: 'a@example.com',
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    usersService = {
      create: jest.fn().mockResolvedValue(userResponse),
      findAll: jest.fn(),
      findOne: jest.fn().mockResolvedValue(userResponse),
      update: jest.fn().mockResolvedValue(userResponse),
      remove: jest.fn().mockResolvedValue(undefined),
      updateAvatar: jest.fn().mockResolvedValue(userResponse),
    } as unknown as jest.Mocked<UsersService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = moduleRef.get(UsersController);
  });

  it('POST /users chuyển DTO xuống service', async () => {
    const dto = { name: 'Nguyen Van A', email: 'a@example.com' };

    await expect(controller.create(dto)).resolves.toBe(userResponse);
    expect(usersService.create).toHaveBeenCalledWith(dto);
  });

  it('GET /users chuyển tham số phân trang xuống service', async () => {
    const paginated = new PaginatedResult([userResponse], {
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    usersService.findAll.mockResolvedValue(paginated);

    await expect(controller.findAll({ page: 1, limit: 20 })).resolves.toBe(paginated);
  });

  it('GET /users/:id gọi findOne với id đã parse', async () => {
    await controller.findOne(7);

    expect(usersService.findOne).toHaveBeenCalledWith(7);
  });

  it('PATCH /users/:id gọi update', async () => {
    await controller.update(7, { name: 'B' });

    expect(usersService.update).toHaveBeenCalledWith(7, { name: 'B' });
  });

  it('DELETE /users/:id gọi remove', async () => {
    await expect(controller.remove(7)).resolves.toBeUndefined();
    expect(usersService.remove).toHaveBeenCalledWith(7);
  });

  it('POST /users/:id/avatar chuyển file xuống service', async () => {
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;

    await controller.uploadAvatar(7, file);

    expect(usersService.updateAvatar).toHaveBeenCalledWith(7, file);
  });
});
