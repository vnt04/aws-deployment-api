export interface ImageType {
  mimeType: string;
  extension: string;
}

const startsWith = (buffer: Buffer, signature: readonly number[], offset = 0): boolean =>
  buffer.length >= offset + signature.length &&
  signature.every((byte, index) => buffer[offset + index] === byte);

const JPEG = [0xff, 0xd8, 0xff] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;

/**
 * Nhận diện định dạng ảnh bằng magic bytes thay vì tin vào mimetype/tên file do client gửi lên.
 */
export const detectImageType = (buffer: Buffer): ImageType | null => {
  if (startsWith(buffer, JPEG)) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(buffer, PNG)) return { mimeType: 'image/png', extension: 'png' };
  if (startsWith(buffer, RIFF) && startsWith(buffer, WEBP, 8)) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
};
