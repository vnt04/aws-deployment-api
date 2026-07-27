import { Environment, validateEnv } from './env.validation';

export interface AppConfig {
  env: Environment;
  port: number;
  corsOrigins: string[] | true;
  throttle: { ttlMs: number; limit: number };
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  synchronize: boolean;
  runMigrations: boolean;
}

export interface StorageConfig {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  publicUrl: string;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  storage: StorageConfig;
}

const parseCorsOrigins = (raw?: string): string[] | true => {
  if (!raw || raw.trim() === '*') return true;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** Đọc + validate biến môi trường đúng một lần khi module khởi tạo. */
export const configuration = (): Configuration => {
  const env = validateEnv(process.env);

  return {
    app: {
      env: env.NODE_ENV,
      port: env.PORT,
      corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
      throttle: { ttlMs: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
    },
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      username: env.DB_USERNAME,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      ssl: env.DB_SSL,
      synchronize: env.DB_SYNCHRONIZE,
      runMigrations: env.DB_RUN_MIGRATIONS,
    },
    storage: {
      region: env.AWS_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      endpoint: env.S3_ENDPOINT,
      publicUrl: stripTrailingSlash(
        env.S3_PUBLIC_URL ?? `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`,
      ),
    },
  };
};
