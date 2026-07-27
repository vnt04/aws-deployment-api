import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildTypeOrmOptions(configService.getOrThrow<DatabaseConfig>('database')),
    }),
  ],
})
export class DatabaseModule {}
