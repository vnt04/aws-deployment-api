import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
