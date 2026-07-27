import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PaginatedResult, buildPaginationMeta } from '../common/dto/api-response';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { detectImageType } from '../storage/image-type';
import { StorageService } from '../storage/storage.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponse, toUserResponse } from './dto/user-response.dto';
import { User } from './entities/user.entity';
import { UsersRepository } from './users.repository';

const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

interface DriverError {
  code?: string;
  driverError?: { code?: string };
}

const isDuplicateEntryError = (error: unknown): boolean => {
  const candidate = error as DriverError;
  return (
    candidate?.code === MYSQL_DUPLICATE_ENTRY ||
    candidate?.driverError?.code === MYSQL_DUPLICATE_ENTRY
  );
};

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly storageService: StorageService,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponse> {
    await this.assertEmailAvailable(dto.email);

    try {
      return toUserResponse(await this.usersRepository.create(dto));
    } catch (error) {
      // Hai request cùng email có thể vượt qua assertEmailAvailable, unique index là chốt chặn cuối.
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(`Email ${dto.email} đã được sử dụng`);
      }
      throw error;
    }
  }

  async findAll({ page, limit }: PaginationQueryDto): Promise<PaginatedResult<UserResponse>> {
    const [users, total] = await this.usersRepository.findAll({ page, limit });

    return new PaginatedResult(users.map(toUserResponse), buildPaginationMeta(total, page, limit));
  }

  async findOne(id: number): Promise<UserResponse> {
    return toUserResponse(await this.getExistingUser(id));
  }

  async update(id: number, dto: UpdateUserDto): Promise<UserResponse> {
    const user = await this.getExistingUser(id);

    if (dto.email && dto.email !== user.email) {
      await this.assertEmailAvailable(dto.email);
    }

    const updated = await this.usersRepository.update(id, dto);

    if (!updated) {
      throw new NotFoundException(`Không tìm thấy user với id ${id}`);
    }

    return toUserResponse(updated);
  }

  async remove(id: number): Promise<void> {
    const user = await this.getExistingUser(id);

    await this.usersRepository.delete(id);
    await this.removeStoredAvatar(user.avatarUrl);
  }

  async updateAvatar(id: number, file?: Express.Multer.File): Promise<UserResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Thiếu file avatar');
    }

    const imageType = detectImageType(file.buffer);

    if (!imageType) {
      throw new BadRequestException('File avatar phải là ảnh JPEG, PNG hoặc WEBP');
    }

    const user = await this.getExistingUser(id);
    const key = `users/${id}/avatar.${imageType.extension}`;

    const avatarUrl = await this.storageService.putObject({
      key,
      body: file.buffer,
      contentType: imageType.mimeType,
    });

    const updated = await this.usersRepository.update(id, { avatarUrl });

    if (!updated) {
      throw new NotFoundException(`Không tìm thấy user với id ${id}`);
    }

    if (user.avatarUrl && user.avatarUrl !== avatarUrl) {
      await this.removeStoredAvatar(user.avatarUrl);
    }

    return toUserResponse(updated);
  }

  private async getExistingUser(id: number): Promise<User> {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException(`Không tìm thấy user với id ${id}`);
    }

    return user;
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.usersRepository.findByEmail(email)) {
      throw new ConflictException(`Email ${email} đã được sử dụng`);
    }
  }

  private async removeStoredAvatar(avatarUrl: string | null): Promise<void> {
    if (!avatarUrl) return;

    const key = this.storageService.resolveKeyFromUrl(avatarUrl);

    if (key) {
      await this.storageService.deleteObjectQuietly(key);
    }
  }
}
