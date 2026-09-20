const ALLOWED_UPLOAD_TYPES = new Set(['avatar', 'note-image', 'attachment', 'document']);

export function selectStorage({ uploadType, mimeType, size = 0, defaultProvider = 'local' }) {
  if (uploadType && !ALLOWED_UPLOAD_TYPES.has(uploadType)) {
    const error = new Error('Invalid upload type');
    error.statusCode = 400;
    throw error;
  }

  if (uploadType === 'avatar' || uploadType === 'note-image') return 'cloudinary';
  if (uploadType === 'attachment' || uploadType === 'document') return 's3';
  if (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) return 'cloudinary';
  if (size > 5 * 1024 * 1024) return 's3';
  return defaultProvider;
}

export function isAllowedUploadType(uploadType) {
  return ALLOWED_UPLOAD_TYPES.has(uploadType);
}
