import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

const MAX_PORT = 65535;

/** Chuỗi rỗng trong .env phải được coi như "không set", không phải giá trị hợp lệ. */
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }) =>
    typeof value === 'string' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : value,
  );

/** process.env luôn trả string nên phải ép kiểu trước khi validate. */
const ToNumber = (): PropertyDecorator =>
  Transform(({ value }) => (isBlank(value) ? undefined : Number(value)));

const ToOptionalString = (): PropertyDecorator =>
  Transform(({ value }) => (isBlank(value) ? undefined : String(value).trim()));

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_PORT)
  @IsOptional()
  PORT = 3000;

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_PORT)
  @IsOptional()
  DB_PORT = 3306;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  DB_SSL = false;

  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  DB_SYNCHRONIZE = false;

  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  DB_RUN_MIGRATIONS = true;

  @IsString()
  @IsNotEmpty()
  AWS_REGION!: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET!: string;

  @ToOptionalString()
  @IsString()
  @IsOptional()
  AWS_ACCESS_KEY_ID?: string;

  @ToOptionalString()
  @IsString()
  @IsOptional()
  AWS_SECRET_ACCESS_KEY?: string;

  @ToOptionalString()
  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  @ToOptionalString()
  @IsString()
  @IsOptional()
  S3_PUBLIC_URL?: string;

  @ToOptionalString()
  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  @ToNumber()
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_TTL_MS = 60_000;

  @ToNumber()
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_LIMIT = 100;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { exposeDefaultValues: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n  - ');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n  - ${details}`);
  }

  return validated;
}
