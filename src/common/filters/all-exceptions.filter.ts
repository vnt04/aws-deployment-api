import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ApiResponse } from '../dto/api-response';

const statusToCode = (status: number): string =>
  HttpStatus[status] ? String(HttpStatus[status]) : 'INTERNAL_SERVER_ERROR';

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${message}`);
    }

    const body: ApiResponse<never> = {
      success: false,
      data: null,
      error: { code: statusToCode(status), message, ...(details ? { details } : {}) },
    };

    response.status(status).json(body);
  }

  /** Không bao giờ để lộ chi tiết lỗi hệ thống ra ngoài response. */
  private describe(exception: unknown): { status: number; message: string; details?: unknown } {
    if (!(exception instanceof HttpException)) {
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Đã có lỗi xảy ra' };
    }

    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { status, message: payload };
    }

    const { message, error } = payload as HttpExceptionBody;

    if (Array.isArray(message)) {
      return { status, message: 'Dữ liệu không hợp lệ', details: message };
    }

    return { status, message: message ?? error ?? exception.message };
  }
}
