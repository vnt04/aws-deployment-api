import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { ApiResponse, PaginatedResult } from '../dto/api-response';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<unknown>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<unknown>> {
    return next.handle().pipe(
      map((payload) => {
        if (payload instanceof PaginatedResult) {
          return { success: true, data: payload.items, error: null, meta: payload.meta };
        }

        return { success: true, data: payload ?? null, error: null };
      }),
    );
  }
}
