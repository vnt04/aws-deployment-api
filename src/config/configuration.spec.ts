import { configuration } from './configuration';
import { Environment, validateEnv } from './env.validation';

const VALID_ENV = {
  DB_HOST: '127.0.0.1',
  DB_USERNAME: 'root',
  DB_PASSWORD: 'password',
  DB_NAME: 'aws_deployment',
  AWS_REGION: 'ap-southeast-1',
  S3_BUCKET: 'my-bucket',
};

describe('validateEnv', () => {
  it('áp dụng giá trị mặc định cho biến không bắt buộc', () => {
    const env = validateEnv({ ...VALID_ENV });

    expect(env.NODE_ENV).toBe(Environment.Development);
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(3306);
    expect(env.DB_SSL).toBe(false);
    expect(env.DB_RUN_MIGRATIONS).toBe(true);
  });

  it('ép string sang number và boolean', () => {
    const env = validateEnv({ ...VALID_ENV, PORT: '8080', DB_SSL: 'true', DB_SYNCHRONIZE: '1' });

    expect(env.PORT).toBe(8080);
    expect(env.DB_SSL).toBe(true);
    expect(env.DB_SYNCHRONIZE).toBe(true);
  });

  it('coi chuỗi rỗng như chưa set (dùng cho IAM Role trên EC2)', () => {
    const env = validateEnv({ ...VALID_ENV, AWS_ACCESS_KEY_ID: '', S3_ENDPOINT: '  ' });

    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it('báo lỗi rõ ràng khi thiếu biến bắt buộc', () => {
    expect(() => validateEnv({})).toThrow(/Cấu hình môi trường không hợp lệ/);
    expect(() => validateEnv({})).toThrow(/DB_HOST/);
  });

  it('từ chối PORT ngoài dải hợp lệ', () => {
    expect(() => validateEnv({ ...VALID_ENV, PORT: '70000' })).toThrow(/PORT/);
  });

  it('từ chối NODE_ENV không nằm trong danh sách cho phép', () => {
    expect(() => validateEnv({ ...VALID_ENV, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...VALID_ENV } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('gom biến môi trường thành các nhóm cấu hình', () => {
    const config = configuration();

    expect(config.database).toMatchObject({ host: '127.0.0.1', port: 3306, ssl: false });
    expect(config.storage).toMatchObject({ region: 'ap-southeast-1', bucket: 'my-bucket' });
    expect(config.app.port).toBe(3000);
  });

  it('suy ra public URL mặc định của S3 khi không cấu hình CDN', () => {
    expect(configuration().storage.publicUrl).toBe(
      'https://my-bucket.s3.ap-southeast-1.amazonaws.com',
    );
  });

  it('ưu tiên S3_PUBLIC_URL và bỏ dấu / thừa ở cuối', () => {
    process.env.S3_PUBLIC_URL = 'https://cdn.yourdomain.com/';

    expect(configuration().storage.publicUrl).toBe('https://cdn.yourdomain.com');
  });

  it('cho phép mọi origin khi CORS_ORIGINS là *', () => {
    process.env.CORS_ORIGINS = '*';

    expect(configuration().app.corsOrigins).toBe(true);
  });

  it('tách CORS_ORIGINS thành danh sách origin', () => {
    process.env.CORS_ORIGINS = 'https://a.com, https://b.com ,';

    expect(configuration().app.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
  });

  it('mặc định cho phép mọi origin khi không cấu hình', () => {
    expect(configuration().app.corsOrigins).toBe(true);
  });
});
