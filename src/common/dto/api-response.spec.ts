import { buildPaginationMeta } from './api-response';

describe('buildPaginationMeta', () => {
  it('làm tròn lên số trang', () => {
    expect(buildPaginationMeta(25, 1, 10)).toEqual({
      total: 25,
      page: 1,
      limit: 10,
      totalPages: 3,
    });
  });

  it('trả về 0 trang khi chưa có bản ghi nào', () => {
    expect(buildPaginationMeta(0, 1, 20).totalPages).toBe(0);
  });

  it('không chia cho 0 khi limit không hợp lệ', () => {
    expect(buildPaginationMeta(10, 1, 0).totalPages).toBe(0);
  });
});
