import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const toInt = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === '' ? undefined : Number(value);

export class PaginationQueryDto {
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  limit: number = DEFAULT_PAGE_SIZE;
}
