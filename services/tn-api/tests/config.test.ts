import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config/env.js';

test('configuration rejects missing database URL and API token without disclosing values', () => {
  assert.throws(() => loadConfig({ TN_ENV: 'test' }), /DATABASE_URL, TN_API_TOKEN/);
});

test('configuration accepts explicit local-only values', () => {
  const config = loadConfig({
    TN_ENV: 'test',
    TN_HOST: '127.0.0.1',
    TN_PORT: '3334',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/talentnexus_test',
    TN_API_TOKEN: 'test-token-that-is-long-enough'
  });
  assert.equal(config.port, 3334);
  assert.equal(config.environment, 'test');
});

test('configuration accepts a deployment-driven Entra resource-server contract', () => {
  const config = loadConfig({
    TN_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/talentnexus_test',
    TN_API_TOKEN: 'test-token-that-is-long-enough',
    ENTRA_TENANT_ID: '26462e96-fb51-4267-bdd9-c087d72c8df9',
    ENTRA_API_CLIENT_ID: '03a79d54-a2a8-4a62-88ce-f1246c1d9d1d',
    ENTRA_REQUIRED_SCOPE: 'TN.Sidecar.Write'
  });
  assert.equal(config.entra?.requiredScope, 'TN.Sidecar.Write');
  assert.equal(config.entra?.issuer, 'https://login.microsoftonline.com/26462e96-fb51-4267-bdd9-c087d72c8df9/v2.0');
});

test('configuration rejects partial Entra settings without echoing configuration values', () => {
  assert.throws(() => loadConfig({
    TN_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/talentnexus_test',
    TN_API_TOKEN: 'test-token-that-is-long-enough',
    ENTRA_TENANT_ID: 'configured-only'
  }), /ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID, ENTRA_REQUIRED_SCOPE/);
});
