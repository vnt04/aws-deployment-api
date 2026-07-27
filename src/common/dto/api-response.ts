export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorBody | null;
  meta?: PaginationMeta;
}

/** Marker class để interceptor biết cần đưa `meta` ra ngoài envelope. */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}
}

export const buildPaginationMeta = (
  total: number,
  page: number,
  limit: number,
): PaginationMeta => ({
  total,
  page,
  limit,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
});
