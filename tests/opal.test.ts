import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Opal, OpalError } from '../src/index.js';

describe('Opal', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opal-test-'));
    configPath = path.join(tempDir, 'store.enc');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('lifecycle errors', () => {
    it('should throw OPAL_NOT_LOADED when accessing before load', () => {
      const store = new Opal({
        appName: 'test-app',
        configPath,
        encryptionKeyEnvVar: 'TEST_KEY',
      });

      try {
        store.get('key');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(OpalError);
        expect((e as OpalError).code).toBe('OPAL_NOT_LOADED');
      }
    });

    it('should throw OPAL_KEY_NOT_FOUND when loading without key', async () => {
      const store = new Opal({
        appName: 'test-app-no-key',
        configPath,
      });

      try {
        await store.load();
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(OpalError);
        expect((e as OpalError).code).toBe('OPAL_KEY_NOT_FOUND');
      }
    });
  });

  describe('with env var key', () => {
    const testKey = 'a'.repeat(64); // 32 bytes in hex

    beforeEach(() => {
      process.env.OPAL_TEST_KEY = testKey;
    });

    afterEach(() => {
      delete process.env.OPAL_TEST_KEY;
    });

    it('should init and load correctly', async () => {
      const store = new Opal({
        appName: 'test-env-app',
        configPath,
        encryptionKeyEnvVar: 'OPAL_TEST_KEY',
      });

      await store.load();
      expect(store.getAll()).toEqual({});
    });

    it('should set and get values', async () => {
      const store = new Opal({
        appName: 'test-env-app',
        configPath,
        encryptionKeyEnvVar: 'OPAL_TEST_KEY',
      });

      await store.load();
      await store.set('apiKey', 'secret123');
      await store.set('config', { nested: true });

      expect(store.get('apiKey')).toBe('secret123');
      expect(store.get<{ nested: boolean }>('config')).toEqual({ nested: true });
    });

    it('should persist data across instances', async () => {
      const store1 = new Opal({
        appName: 'test-persist',
        configPath,
        encryptionKeyEnvVar: 'OPAL_TEST_KEY',
      });

      await store1.load();
      await store1.set('token', 'abc123');

      // Create new instance
      const store2 = new Opal({
        appName: 'test-persist',
        configPath,
        encryptionKeyEnvVar: 'OPAL_TEST_KEY',
      });

      await store2.load();
      expect(store2.get('token')).toBe('abc123');
    });

    it('should delete values', async () => {
      const store = new Opal({
        appName: 'test-delete',
        configPath,
        encryptionKeyEnvVar: 'OPAL_TEST_KEY',
      });

      await store.load();
      await store.set('temp', 'value');
      expect(store.get('temp')).toBe('value');

      await store.delete('temp');
      expect(store.get('temp')).toBeNull();
    });

    it('should reject invalid key length', async () => {
      process.env.OPAL_BAD_KEY = 'tooshort';

      const store = new Opal({
        appName: 'test-bad-key',
        configPath,
        encryptionKeyEnvVar: 'OPAL_BAD_KEY',
      });

      try {
        await store.load();
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(OpalError);
        expect((e as OpalError).code).toBe('OPAL_INVALID_KEY');
      }

      delete process.env.OPAL_BAD_KEY;
    });
  });
});
