import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';

import { configuration } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm-options';

/** DataSource dành riêng cho TypeORM CLI (migration:run / migration:revert). */
const options = buildTypeOrmOptions(configuration().database) as DataSourceOptions;

export default new DataSource({ ...options, migrationsRun: false, synchronize: false });
