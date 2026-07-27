import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { MAX_PAGE_SIZE, PaginationQueryDto } from './pagination-query.dto';

const parse = (query: Record<string, unknown>): PaginationQueryDto =>
  plainToInstance(PaginationQueryDto, query, { exposeDefaultValues: true });

describe('PaginationQueryDto', () => {
  it('dùng giá trị mặc định khi client không truyền gì', () => {
    const dto = parse({});

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto).toEqual({ page: 1, limit: 20 });
  });

  it('ép query string sang number', () => {
    const dto = parse({ page: '3', limit: '50' });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto).toEqual({ page: 3, limit: 50 });
  });

  it('từ chối limit vượt trần để tránh query không giới hạn', () => {
    const errors = validateSync(parse({ limit: String(MAX_PAGE_SIZE + 1) }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('từ chối page nhỏ hơn 1', () => {
    expect(validateSync(parse({ page: '0' }))).toHaveLength(1);
  });

  it('từ chối giá trị không phải số', () => {
    expect(validateSync(parse({ page: 'abc' }))).toHaveLength(1);
  });
});
