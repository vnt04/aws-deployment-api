import { detectImageType } from './image-type';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);

describe('detectImageType', () => {
  it('nhận diện JPEG từ magic bytes', () => {
    expect(detectImageType(JPEG_BYTES)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('nhận diện PNG từ magic bytes', () => {
    expect(detectImageType(PNG_BYTES)).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('nhận diện WEBP từ cặp signature RIFF + WEBP', () => {
    expect(detectImageType(WEBP_BYTES)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('trả về null khi file không phải ảnh được hỗ trợ', () => {
    expect(detectImageType(Buffer.from('%PDF-1.7 fake pdf'))).toBeNull();
  });

  it('trả về null với RIFF nhưng không phải WEBP (ví dụ file WAV)', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
    ]);

    expect(detectImageType(wav)).toBeNull();
  });

  it('trả về null với buffer rỗng hoặc quá ngắn', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
