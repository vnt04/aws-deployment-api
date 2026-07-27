import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

const parse = (payload: Record<string, unknown>): CreateUserDto =>
  plainToInstance(CreateUserDto, payload);

describe('CreateUserDto', () => {
  it('chấp nhận payload hợp lệ', () => {
    const dto = parse({ name: 'Nguyen Van A', email: 'a@example.com' });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('trim tên và chuẩn hoá email về chữ thường', () => {
    const dto = parse({ name: '  Nguyen Van A  ', email: '  A@Example.COM ' });

    expect(dto.name).toBe('Nguyen Van A');
    expect(dto.email).toBe('a@example.com');
  });

  it('từ chối email sai định dạng', () => {
    const errors = validateSync(parse({ name: 'A', email: 'khong-phai-email' }));

    expect(errors.map((error) => error.property)).toContain('email');
  });

  it('từ chối tên rỗng sau khi trim', () => {
    const errors = validateSync(parse({ name: '   ', email: 'a@example.com' }));

    expect(errors.map((error) => error.property)).toContain('name');
  });

  it('từ chối tên vượt quá 120 ký tự', () => {
    const errors = validateSync(parse({ name: 'a'.repeat(121), email: 'a@example.com' }));

    expect(errors.map((error) => error.property)).toContain('name');
  });

  it('từ chối giá trị không phải string', () => {
    const errors = validateSync(parse({ name: 123, email: 'a@example.com' }));

    expect(errors.map((error) => error.property)).toContain('name');
  });
});

describe('UpdateUserDto', () => {
  it('cho phép cập nhật từng phần', () => {
    const dto = plainToInstance(UpdateUserDto, { name: 'Tran Van B' });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('vẫn validate field được gửi lên', () => {
    const dto = plainToInstance(UpdateUserDto, { email: 'sai-email' });

    expect(validateSync(dto)).toHaveLength(1);
  });
});
