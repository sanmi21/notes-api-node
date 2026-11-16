import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CloudinaryStorage } from '../src/storage/providers/cloudinary.storage.js';
import { LocalStorage } from '../src/storage/providers/local.storage.js';
import { S3Storage } from '../src/storage/providers/s3.storage.js';
import { clearStorageCache, getStorage } from '../src/storage/storage.factory.js';
import { selectStorage } from '../src/storage/storage.selector.js';
import {
  deleteStoredUpload,
  getStoredUploadDownload,
  storageKey,
  storeUpload
} from '../src/storage/storage.service.js';
import { getStorageConfig } from '../src/storage/storage.config.js';
import { findOwnedUpload } from '../src/storage/upload-access.js';

const config = {
  defaultProvider: 'local',
  local: {uploadDir: path.join(os.tmpdir(), 'notelify-tests'), publicUrl: '/uploads'},
  s3: {bucket: 'test', region: 'test', signedUrlExpiresIn: 300},
  cloudinary: {cloudName: 'test', apiKey: 'test', apiSecret: 'test', folder: 'test'}
};

test.afterEach(() => clearStorageCache());

test('factory uses the configured default provider', () => {
  assert.ok(getStorage(undefined, {config}) instanceof LocalStorage);
  assert.equal(getStorageConfig({STORAGE_PROVIDER: 's3'}).defaultProvider, 's3');
});

test('legacy requests without uploadType use STORAGE_PROVIDER', async () => {
  const previousProvider = process.env.STORAGE_PROVIDER;
  const previousDirectory = process.env.LOCAL_UPLOAD_DIR;
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notelify-default-'));
  process.env.STORAGE_PROVIDER = 'local';
  process.env.LOCAL_UPLOAD_DIR = uploadDir;
  clearStorageCache();
  try {
    const result = await storeUpload({
      buffer: Buffer.from('data'), mimetype: 'application/octet-stream', originalname: 'file.bin', size: 4
    }, {useDefaultProvider: true});
    assert.equal(result.provider, 'local');
    await deleteStoredUpload(result);
  } finally {
    if (previousProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previousProvider;
    if (previousDirectory === undefined) delete process.env.LOCAL_UPLOAD_DIR;
    else process.env.LOCAL_UPLOAD_DIR = previousDirectory;
    clearStorageCache();
    await fs.rm(uploadDir, {recursive: true, force: true});
  }
});

test('factory returns every supported provider implementation', () => {
  assert.ok(getStorage('local', {config}) instanceof LocalStorage);
  assert.ok(getStorage('s3', {config}) instanceof S3Storage);
  assert.ok(getStorage('cloudinary', {config}) instanceof CloudinaryStorage);
});

test('factory rejects unknown providers without exposing configuration', () => {
  assert.throws(() => getStorage('unknown', {config}), /Unsupported storage provider/);
});

test('selector applies business-intent policy', () => {
  assert.equal(selectStorage({uploadType: 'note-image', defaultProvider: 'local'}), 'cloudinary');
  assert.equal(selectStorage({uploadType: 'avatar', defaultProvider: 'local'}), 'cloudinary');
  assert.equal(selectStorage({uploadType: 'attachment', defaultProvider: 'local'}), 's3');
  assert.equal(selectStorage({uploadType: 'document', defaultProvider: 'local'}), 's3');
  assert.equal(selectStorage({mimeType: 'application/octet-stream', defaultProvider: 'local'}), 'local');
});

test('selector rejects invalid upload types', () => {
  assert.throws(() => selectStorage({uploadType: 'cloudinary'}), /Invalid upload type/);
});

test('local provider normalizes upload metadata and supports private retrieval/deletion', async () => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notelify-storage-'));
  const storage = new LocalStorage({uploadDir, publicUrl: '/uploads'});
  const file = {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mimetype: 'image/png',
    originalname: '../../profile.png',
    size: 4
  };
  const result = await storage.upload(file, {folder: 'notes/1'});

  assert.deepEqual(Object.keys(result).sort(), [
    'key', 'metadata', 'mimeType', 'originalName', 'provider', 'resourceType', 'size', 'url'
  ]);
  assert.equal(result.provider, 'local');
  assert.equal(result.originalName, '../../profile.png');
  assert.match(result.key, /^notes\/1\/[0-9a-f-]+\.png$/);
  assert.equal((await storage.getDownload(result.key)).type, 'file');
  assert.equal(await storage.delete(result.key), true);
  await fs.rm(uploadDir, {recursive: true, force: true});
});

test('legacy and current records resolve keys from their stored provider metadata', () => {
  assert.equal(storageKey({provider: 's3', key: 'notes/1/file.pdf'}), 'notes/1/file.pdf');
  assert.equal(storageKey({provider: 'local', url: '/uploads/legacy.png'}), 'legacy.png');
});

test('retrieval and deletion dispatch using the provider stored on each record', async () => {
  const calls = [];
  const fakeStorage = {
    getDownload: async (key) => ({type: 'redirect', url: `https://example.test/${key}`}),
    delete: async (key) => calls.push(['delete', key])
  };
  const factory = (provider) => {
    calls.push(['provider', provider]);
    return fakeStorage;
  };
  const record = {provider: 'cloudinary', key: 'notes/1/asset', resourceType: 'image'};

  await getStoredUploadDownload(record, {getStorage: factory});
  await deleteStoredUpload(record, {getStorage: factory});
  assert.deepEqual(calls, [
    ['provider', 'cloudinary'],
    ['provider', 'cloudinary'],
    ['delete', 'notes/1/asset']
  ]);
});

test('S3 responses are normalized and downloads are signed without exposing credentials', async () => {
  const commands = [];
  const client = {send: async (command) => commands.push(command)};
  const storage = new S3Storage(config.s3, {
    client,
    getSignedUrl: async () => 'https://signed.example/file'
  });
  const result = await storage.upload({
    buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'report.pdf', size: 3
  }, {folder: 'notes/2'});

  assert.equal(result.provider, 's3');
  assert.equal(result.resourceType, 'raw');
  assert.match(result.key, /^notes\/2\/[0-9a-f-]+\.pdf$/);
  assert.equal((await storage.getDownload(result.key)).url, 'https://signed.example/file');
  assert.equal(commands.length, 1);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Cloudinary responses are normalized and external calls are mocked', async () => {
  const fakeCloudinary = {
    config() {},
    url: (key) => `https://signed.cloudinary.example/${key}`,
    uploader: {
      upload_stream(options, callback) {
        return {
          end() {
            callback(null, {
              public_id: options.public_id,
              secure_url: 'https://delivery.example/image',
              bytes: 12,
              resource_type: 'image',
              width: 20,
              height: 10
            });
          }
        };
      },
      destroy: async () => ({result: 'ok'})
    }
  };
  const storage = new CloudinaryStorage(config.cloudinary, {cloudinary: fakeCloudinary});
  const result = await storage.upload({
    buffer: Buffer.from('image'), mimetype: 'image/png', originalname: 'image.png', size: 5
  });

  assert.deepEqual(result.metadata, {width: 20, height: 10});
  assert.equal(result.provider, 'cloudinary');
  assert.equal(await storage.delete(result.key), true);
  assert.match((await storage.getDownload(result.key)).url, /^https:\/\/signed\.cloudinary\.example/);
});

test('ownership lookup scopes retrieval and deletion candidates to the authenticated user', async () => {
  let receivedWhere;
  const database = {
    noteImage: {
      findFirst: async ({where}) => {
        receivedWhere = where;
        return null;
      }
    }
  };
  const result = await findOwnedUpload(database, {imageId: 9, noteId: 2, userId: 41});

  assert.equal(result, null);
  assert.deepEqual(receivedWhere, {id: 9, noteId: 2, note: {userId: 41}});
});
