import path from 'node:path';

export const STORAGE_PROVIDERS = Object.freeze(['local', 's3', 'cloudinary']);

export function getStorageConfig(env = process.env) {
  return {
    defaultProvider: (env.STORAGE_PROVIDER || 'local').toLowerCase(),
    local: {
      uploadDir: path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR || 'uploads'),
      publicUrl: (env.LOCAL_UPLOAD_URL || '/uploads').replace(/\/$/, '')
    },
    s3: {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      signedUrlExpiresIn: Number(env.S3_SIGNED_URL_EXPIRES_IN || 300)
    },
    cloudinary: {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      folder: env.CLOUDINARY_FOLDER || 'notelify'
    }
  };
}

export function assertSupportedProvider(provider) {
  if (!STORAGE_PROVIDERS.includes(provider)) {
    throw new StorageConfigError(`Unsupported storage provider: ${provider}`);
  }
}

export class StorageConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageConfigError';
    this.statusCode = 500;
  }
}
