/**
 * Manual test script for Opal
 * Run with: npm run build && node --experimental-strip-types examples/demo.ts
 */

import * as os from 'os';
import * as path from 'path';
import { Opal, OpalError } from '../dist/index.js';

const configPath = path.join(os.tmpdir(), 'opal-demo', 'store.enc');

async function main() {
  console.log('🔐 Opal Demo\n');
  console.log(`Config path: ${configPath}\n`);

  const store = new Opal({
    appName: 'opal-demo',
    configPath,
  });

  try {
    // Try to init (first run) or load (subsequent runs)
    try {
      await store.init();
      console.log('✅ Initialized new store (key saved to OS keychain)\n');
    } catch (e) {
      if (e instanceof OpalError && e.code === 'OPAL_ALREADY_INIT') {
        await store.load();
        console.log('✅ Loaded existing store\n');
      } else {
        throw e;
      }
    }

    // Show current state
    console.log('📦 Current data:', store.getAll());

    // Set some values
    await store.set('apiKey', 'sk-secret-12345');
    await store.set('config', {
      debug: true,
      maxRetries: 3,
      endpoints: ['https://api.example.com'],
    });
    console.log('\n✏️  Set apiKey and config');

    // Read back
    console.log('\n📖 Reading back:');
    console.log('  apiKey:', store.get('apiKey'));
    console.log('  config:', store.get('config'));

    // Get all
    console.log('\n📦 All data:', store.getAll());

    // Delete a key
    await store.delete('apiKey');
    console.log('\n🗑️  Deleted apiKey');
    console.log('  apiKey:', store.get('apiKey'));

    console.log('\n✅ Demo complete!');
    console.log('💡 Run again to see data persistence.\n');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
