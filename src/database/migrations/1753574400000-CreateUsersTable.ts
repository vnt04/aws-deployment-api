import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1753574400000 implements MigrationInterface {
  name = 'CreateUsersTable1753574400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(120) NOT NULL,
        \`email\` VARCHAR(255) NOT NULL,
        \`avatar_url\` VARCHAR(512) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_users_email\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `users`');
  }
}
