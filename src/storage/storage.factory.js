import { CloudinaryStorage } from './providers/cloudinary.storage.js';
import { LocalStorage } from './providers/local.storage.js';
import { S3Storage } from './providers/s3.storage.js';
import { assertSupportedProvider, getStorageConfig } from './storage.config.js';

const instances = new Map();

export function getStorage(provider, options = {}) {
  const config = options.config || getStorageConfig();
  const selected = (provider || config.defaultProvider).toLowerCase();
  assertSupportedProvider(selected);

  if (!options.dependencies && instances.has(selected)) return instances.get(selected);

  const storage = createStorage(selected, config, options.dependencies);
  if (!options.dependencies) instances.set(selected, storage);
  return storage;
}

export function clearStorageCache() {
  instances.clear();
}

function createStorage(provider, config, dependencies = {}) {
  if (provider === 'local') return new LocalStorage(config.local);
  if (provider === 's3') return new S3Storage(config.s3, dependencies.s3);
  return new CloudinaryStorage(config.cloudinary, dependencies.cloudinary);
}
