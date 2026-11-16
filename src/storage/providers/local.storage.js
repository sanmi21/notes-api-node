import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['application/pdf', '.pdf']
]);

export class LocalStorage {
  constructor(config) {
    this.provider = 'local';
    this.uploadDir = config.uploadDir;
    this.publicUrl = config.publicUrl;
  }

  async upload(file, options = {}) {
    if (!Buffer.isBuffer(file?.buffer)) {
      throw new Error('Local storage requires an in-memory file buffer');
    }

    const folder = safeFolder(options.folder);
    const extension = EXTENSIONS.get(file.mimetype) || '';
    const filename = `${crypto.randomUUID()}${extension}`;
    const key = folder ? `${folder}/${filename}` : filename;
    const target = this.#resolveKey(key);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.buffer, { flag: 'wx' });

    return {
      provider: this.provider,
      key,
      url: this.getUrl(key),
      mimeType: file.mimetype,
      size: file.size ?? file.buffer.length,
      originalName: file.originalname,
      resourceType: resourceTypeFor(file.mimetype),
      metadata: {}
    };
  }

  async delete(key) {
    try {
      await fs.unlink(this.#resolveKey(key));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  getUrl(key) {
    return `${this.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async getDownload(key) {
    const filePath = this.#resolveKey(key);
    await fs.access(filePath);
    return { type: 'file', path: filePath };
  }

  #resolveKey(key) {
    if (typeof key !== 'string' || !key) throw new Error('Invalid storage key');
    const normalized = key.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('Invalid storage key');
    }
    const resolved = path.resolve(this.uploadDir, ...normalized.split('/'));
    const relative = path.relative(this.uploadDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid storage key');
    }
    return resolved;
  }
}

function safeFolder(folder = '') {
  if (!folder) return '';
  return String(folder)
    .split('/')
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(Boolean)
    .join('/');
}

function resourceTypeFor(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'raw';
}
