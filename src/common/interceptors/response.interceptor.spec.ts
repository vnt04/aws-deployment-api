import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { PaginatedResult } from '../dto/api-response';
import { ResponseInterceptor } from './response.interceptor';

const context = {} as ExecutionContext;
const handlerOf = <T>(value: T): CallHandler<T> => ({ handle: () => of(value) });

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('bọc payload thường vào envelope thành công', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(context, handlerOf({ id: 1, name: 'A' })),
    );

    expect(result).toEqual({ success: true, data: { id: 1, name: 'A' }, error: null });
  });

  it('đưa meta phân trang ra ngoài envelope', async () => {
    const meta = { total: 30, page: 2, limit: 10, totalPages: 3 };
    const payload = new PaginatedResult([{ id: 1 }], meta);

    const result = await firstValueFrom(interceptor.intercept(context, handlerOf(payload)));

    expect(result).toEqual({ success: true, data: [{ id: 1 }], error: null, meta });
  });

  it('chuyển undefined thành data null', async () => {
    const result = await firstValueFrom(interceptor.intercept(context, handlerOf(undefined)));

    expect(result).toEqual({ success: true, data: null, error: null });
  });
});
