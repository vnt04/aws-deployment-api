import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';

interface HealthStatus {
  status: 'ok';
  uptime: number;
}

interface ReadinessStatus extends HealthStatus {
  database: 'up';
}

@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Liveness: chỉ cần biết process còn sống — Nginx/ALB gọi endpoint này. */
  @Get()
  liveness(): HealthStatus {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Readiness: kiểm tra thật kết nối RDS trước khi nhận traffic. */
  @Get('ready')
  async readiness(): Promise<ReadinessStatus> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      this.logger.error(
        'Database health check thất bại',
        error instanceof Error ? error.stack : error,
      );
      throw new ServiceUnavailableException('Database không sẵn sàng');
    }

    return { status: 'ok', uptime: process.uptime(), database: 'up' };
  }
}
