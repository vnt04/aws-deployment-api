import { User } from '../entities/user.entity';

export interface UserResponse {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toUserResponse = (user: User): UserResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
