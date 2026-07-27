import { User } from '../src/users/entities/user.entity';
import { FindAllOptions, UserWritableFields } from '../src/users/users.repository';

const PUBLIC_URL = 'https://test-bucket.s3.ap-southeast-1.amazonaws.com';

/** Repository in-memory: e2e chạy được mà không cần MySQL. */
export class FakeUsersRepository {
  private readonly rows = new Map<number, User>();
  private nextId = 1;

  async create(data: Pick<User, 'name' | 'email'>): Promise<User> {
    const now = new Date();
    const user: User = {
      id: this.nextId++,
      ...data,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(user.id, user);
    return user;
  }

  async findAll({ page, limit }: FindAllOptions): Promise<[User[], number]> {
    const all = [...this.rows.values()].sort((a, b) => b.id - a.id);
    return [all.slice((page - 1) * limit, (page - 1) * limit + limit), all.length];
  }

  async findById(id: number): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return [...this.rows.values()].find((user) => user.email === email) ?? null;
  }

  async update(id: number, data: UserWritableFields): Promise<User | null> {
    const current = this.rows.get(id);
    if (!current) return null;

    const updated: User = { ...current, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: number): Promise<boolean> {
    return this.rows.delete(id);
  }
}

/** Storage in-memory: e2e chạy được mà không cần credential AWS. */
export class FakeStorageService {
  readonly objects = new Map<string, Buffer>();
  readonly deletedKeys: string[] = [];

  async putObject({ key, body }: { key: string; body: Buffer }): Promise<string> {
    this.objects.set(key, body);
    return this.buildPublicUrl(key);
  }

  async deleteObjectQuietly(key: string): Promise<void> {
    this.objects.delete(key);
    this.deletedKeys.push(key);
  }

  buildPublicUrl(key: string): string {
    return `${PUBLIC_URL}/${key}`;
  }

  resolveKeyFromUrl(url: string): string | null {
    const prefix = `${PUBLIC_URL}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
