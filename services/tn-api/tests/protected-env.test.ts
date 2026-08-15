import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadProtectedEnvFile } from '../src/config/protected-env.js';

test('protected env loader preserves SQL connection string values without logging', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tn-protected-env-'));
  const path = join(directory, 'runtime.env');
  const key = 'TN_TEST_PROTECTED_ENV';
  try {
    writeFileSync(path, `${key}=Driver={SQL Server Native Client 10.0};Server=lpc:TN;Pwd=a=b;\n`, 'utf8');
    delete process.env[key];
    loadProtectedEnvFile(path);
    assert.equal(process.env[key], 'Driver={SQL Server Native Client 10.0};Server=lpc:TN;Pwd=a=b;');
  } finally {
    delete process.env[key];
    rmSync(directory, { recursive: true, force: true });
  }
});
