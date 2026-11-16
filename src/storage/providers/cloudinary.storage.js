import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { StorageConfigError } from '../storage.config.js';

export class CloudinaryStorage {
  constructor(config, dependencies = {}) {
    this.provider = 'cloudinary';
    this.config = config;
    this.cloudinary = dependencies.cloudinary || cloudinary;
    this.configured = false;
  }

  async upload(file, options = {}) {
    this.#configure();
    if (!Buffer.isBuffer(file?.buffer)) {
      throw new Error('Cloudinary storage requires an in-memory file buffer');
    }

    const resourceType = cloudinaryResourceType(file.mimetype);
    const folder = options.folder || this.config.folder;
    const publicId = `${folder}/${crypto.randomUUID()}`;
    const result = await new Promise((resolve, reject) => {
      const stream = this.cloudinary.uploader.upload_stream({
        public_id: publicId,
        resource_type: resourceType,
        type: 'authenticated',
        overwrite: false
      }, (error, uploadResult) => error ? reject(error) : resolve(uploadResult));
      stream.end(file.buffer);
    });

    return {
      provider: this.provider,
      key: result.public_id,
      url: result.secure_url || null,
      mimeType: file.mimetype,
      size: result.bytes ?? file.size ?? file.buffer.length,
      originalName: file.originalname,
      resourceType: result.resource_type || resourceType,
      metadata: compactMetadata(result)
    };
  }

  async delete(key, options = {}) {
    this.#configure();
    const result = await this.cloudinary.uploader.destroy(key, {
      resource_type: options.resourceType || 'image',
      type: 'authenticated',
      invalidate: true
    });
    return result.result === 'ok' || result.result === 'not found';
  }

  getUrl(key, options = {}) {
    this.#configure();
    return this.cloudinary.url(key, {
      secure: true,
      sign_url: true,
      type: 'authenticated',
      resource_type: options.resourceType || 'image'
    });
  }

  async getDownload(key, options = {}) {
    return { type: 'redirect', url: this.getUrl(key, options) };
  }

  #configure() {
    if (!this.config.cloudName || !this.config.apiKey || !this.config.apiSecret) {
      throw new StorageConfigError('Cloudinary storage is not configured');
    }
    if (!this.configured) {
      this.cloudinary.config({
        cloud_name: this.config.cloudName,
        api_key: this.config.apiKey,
        api_secret: this.config.apiSecret,
        secure: true
      });
      this.configured = true;
    }
  }
}

function cloudinaryResourceType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'raw';
}

function compactMetadata(result) {
  const metadata = {};
  if (result.width != null) metadata.width = result.width;
  if (result.height != null) metadata.height = result.height;
  if (result.format) metadata.format = result.format;
  return metadata;
}
