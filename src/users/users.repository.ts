import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';

export interface FindAllOptions {
  page: number;
  limit: number;
}

export type UserWritableFields = Partial<Pick<User, 'name' | 'email' | 'avatarUrl'>>;

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async create(data: Pick<User, 'name' | 'email'>): Promise<User> {
    return this.repository.save(this.repository.create(data));
  }

  async findAll({ page, limit }: FindAllOptions): Promise<[User[], number]> {
    return this.repository.findAndCount({
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  /** Trả về bản ghi mới đọc lại từ DB thay vì mutate entity đang giữ trên bộ nhớ. */
  async update(id: number, data: UserWritableFields): Promise<User | null> {
    await this.repository.update({ id }, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
