import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'node:path';

import { DatabaseConfig } from '../config/configuration';

export const buildTypeOrmOptions = (config: DatabaseConfig): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  database: config.database,
  charset: 'utf8mb4',
  timezone: 'Z',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: config.synchronize,
  migrationsRun: config.runMigrations,
  // RDS dùng chứng chỉ do AWS cấp; bật TLS mà không pin CA để tránh phải bundle rds-ca-*.pem.
  ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  extra: { connectionLimit: 10 },
});
