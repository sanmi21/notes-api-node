import path from 'node:path';
import { getStorage } from './storage.factory.js';
import { getStorageConfig } from './storage.config.js';
import { selectStorage } from './storage.selector.js';

export async function storeUpload(file, options = {}) {
  const config = getStorageConfig();
  const provider = options.useDefaultProvider
    ? config.defaultProvider
    : selectStorage({
        uploadType: options.uploadType,
        mimeType: file.mimetype,
        size: file.size,
        defaultProvider: config.defaultProvider
      });
  const storage = getStorage(provider);
  return storage.upload(file, options);
}

export async function deleteStoredUpload(record, dependencies = {}) {
  const storage = (dependencies.getStorage || getStorage)(record.provider || 'local');
  return storage.delete(storageKey(record), { resourceType: record.resourceType });
}

export async function getStoredUploadDownload(record, dependencies = {}) {
  const storage = (dependencies.getStorage || getStorage)(record.provider || 'local');
  return storage.getDownload(storageKey(record), { resourceType: record.resourceType });
}

export function storageKey(record) {
  if (record.key) return record.key;
  if ((record.provider || 'local') === 'local' && record.url) return path.basename(record.url);
  throw new Error('Stored upload has no storage key');
}
