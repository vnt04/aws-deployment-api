import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const buildHost = (response: CapturedResponse): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/users/1' }),
    }),
  }) as unknown as ArgumentsHost;

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let response: CapturedResponse;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    filter = new AllExceptionsFilter();
    response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('map HttpException sang envelope lỗi kèm code theo status', () => {
    filter.catch(new NotFoundException('Không tìm thấy user với id 1'), buildHost(response));

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy user với id 1' },
    });
  });

  it('gom lỗi validation dạng mảng vào details', () => {
    filter.catch(
      new BadRequestException(['email must be an email', 'name should not be empty']),
      buildHost(response),
    );

    expect(response.json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: {
        code: 'BAD_REQUEST',
        message: 'Dữ liệu không hợp lệ',
        details: ['email must be an email', 'name should not be empty'],
      },
    });
  });

  it('giữ nguyên message khi exception được tạo từ string', () => {
    filter.catch(new UnprocessableEntityException('Không xử lý được'), buildHost(response));

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'UNPROCESSABLE_ENTITY', message: 'Không xử lý được' },
      }),
    );
  });

  it('không để lộ chi tiết lỗi hệ thống ra response', () => {
    filter.catch(new Error('connect ECONNREFUSED 10.0.1.20:3306'), buildHost(response));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Đã có lỗi xảy ra' },
    });
  });

  it('vẫn trả envelope hợp lệ khi exception không phải Error', () => {
    filter.catch('boom', buildHost(response));

    expect(response.status).toHaveBeenCalledWith(500);
  });
});
