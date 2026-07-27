import { DatabaseConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm-options';

const baseConfig: DatabaseConfig = {
  host: 'db.internal',
  port: 3306,
  username: 'app',
  password: 'secret',
  database: 'aws_deployment',
  ssl: false,
  synchronize: false,
  runMigrations: true,
};

describe('buildTypeOrmOptions', () => {
  it('map cấu hình sang option của TypeORM', () => {
    expect(buildTypeOrmOptions(baseConfig)).toMatchObject({
      type: 'mysql',
      host: 'db.internal',
      database: 'aws_deployment',
      synchronize: false,
      migrationsRun: true,
    });
  });

  it('không bật TLS khi DB_SSL=false (MySQL container ở local)', () => {
    expect(buildTypeOrmOptions(baseConfig)).toMatchObject({ ssl: undefined });
  });

  it('bật TLS khi kết nối RDS', () => {
    expect(buildTypeOrmOptions({ ...baseConfig, ssl: true })).toMatchObject({
      ssl: { rejectUnauthorized: false },
    });
  });
});
