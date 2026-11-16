import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageConfigError } from '../storage.config.js';

export class S3Storage {
  constructor(config, dependencies = {}) {
    this.provider = 's3';
    this.config = config;
    this.client = dependencies.client;
    this.signUrl = dependencies.getSignedUrl || getSignedUrl;
  }

  async upload(file, options = {}) {
    this.#assertConfigured();
    if (!Buffer.isBuffer(file?.buffer)) throw new Error('S3 storage requires an in-memory file buffer');

    const key = createKey(options.folder, file.mimetype);
    await this.#getClient().send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: { originalname: encodeURIComponent(file.originalname || 'file') }
    }));

    return {
      provider: this.provider,
      key,
      url: null,
      mimeType: file.mimetype,
      size: file.size ?? file.buffer.length,
      originalName: file.originalname,
      resourceType: resourceTypeFor(file.mimetype),
      metadata: {}
    };
  }

  async delete(key) {
    this.#assertConfigured();
    await this.#getClient().send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return true;
  }

  async getUrl(key, options = {}) {
    this.#assertConfigured();
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return this.signUrl(this.#getClient(), command, {
      expiresIn: options.expiresIn || this.config.signedUrlExpiresIn
    });
  }

  async getDownload(key, options = {}) {
    return { type: 'redirect', url: await this.getUrl(key, options) };
  }

  #getClient() {
    if (!this.client) {
      const credentials = this.config.accessKeyId && this.config.secretAccessKey
        ? { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey }
        : undefined;
      this.client = new S3Client({
        region: this.config.region,
        endpoint: this.config.endpoint || undefined,
        forcePathStyle: this.config.forcePathStyle,
        credentials
      });
    }
    return this.client;
  }

  #assertConfigured() {
    if (!this.config.bucket || !this.config.region) {
      throw new StorageConfigError('S3 storage is not configured');
    }
  }
}

function createKey(folder = 'uploads', mimeType = '') {
  const extension = MIME_EXTENSIONS.get(mimeType) || '';
  const safeFolder = String(folder || 'uploads').replace(/[^a-zA-Z0-9/_-]/g, '');
  return `${safeFolder}/${crypto.randomUUID()}${extension}`;
}

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['application/pdf', '.pdf']
]);

function resourceTypeFor(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'raw';
}
