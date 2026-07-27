import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([{ 1: 1 }]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getDataSourceToken(), useValue: { query } as unknown as DataSource }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('liveness không chạm tới database', () => {
    expect(controller.liveness()).toMatchObject({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('readiness báo ok khi query database thành công', async () => {
    await expect(controller.readiness()).resolves.toMatchObject({
      status: 'ok',
      database: 'up',
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('readiness trả 503 khi database không kết nối được', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
