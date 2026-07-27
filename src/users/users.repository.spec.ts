import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';
import { UsersRepository } from './users.repository';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  name: 'Nguyen Van A',
  email: 'a@example.com',
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UsersRepository', () => {
  let usersRepository: UsersRepository;
  let typeOrmRepository: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    typeOrmRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: getRepositoryToken(User), useValue: typeOrmRepository },
      ],
    }).compile();

    usersRepository = moduleRef.get(UsersRepository);
  });

  it('create lưu entity mới', async () => {
    const data = { name: 'Nguyen Van A', email: 'a@example.com' };
    typeOrmRepository.create.mockReturnValue(data as User);
    typeOrmRepository.save.mockResolvedValue(buildUser());

    await expect(usersRepository.create(data)).resolves.toMatchObject({ id: 1 });
    expect(typeOrmRepository.save).toHaveBeenCalledWith(data);
  });

  it('findAll tính offset từ page/limit và sắp xếp mới nhất trước', async () => {
    typeOrmRepository.findAndCount.mockResolvedValue([[buildUser()], 1]);

    await usersRepository.findAll({ page: 3, limit: 20 });

    expect(typeOrmRepository.findAndCount).toHaveBeenCalledWith({
      order: { id: 'DESC' },
      skip: 40,
      take: 20,
    });
  });

  it('findById tìm theo khoá chính', async () => {
    typeOrmRepository.findOne.mockResolvedValue(buildUser());

    await usersRepository.findById(1);

    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('findByEmail tìm theo email', async () => {
    typeOrmRepository.findOne.mockResolvedValue(null);

    await expect(usersRepository.findByEmail('x@example.com')).resolves.toBeNull();
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({ where: { email: 'x@example.com' } });
  });

  it('update ghi dữ liệu rồi đọc lại bản ghi mới', async () => {
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: {}, generatedMaps: [] });
    typeOrmRepository.findOne.mockResolvedValue(buildUser({ name: 'Updated' }));

    const result = await usersRepository.update(1, { name: 'Updated' });

    expect(typeOrmRepository.update).toHaveBeenCalledWith({ id: 1 }, { name: 'Updated' });
    expect(result?.name).toBe('Updated');
  });

  it('delete trả về true khi có bản ghi bị xoá', async () => {
    typeOrmRepository.delete.mockResolvedValue({ affected: 1, raw: {} });

    await expect(usersRepository.delete(1)).resolves.toBe(true);
  });

  it('delete trả về false khi không có bản ghi nào bị xoá', async () => {
    typeOrmRepository.delete.mockResolvedValue({ affected: 0, raw: {} });

    await expect(usersRepository.delete(99)).resolves.toBe(false);
  });

  it('delete trả về false khi driver không báo số dòng ảnh hưởng', async () => {
    typeOrmRepository.delete.mockResolvedValue({ affected: null, raw: {} });

    await expect(usersRepository.delete(99)).resolves.toBe(false);
  });
});
