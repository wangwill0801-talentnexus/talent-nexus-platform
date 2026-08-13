import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { buildApp } from '../src/app.js';
import { EntraAccessTokenError, MicrosoftEntraAccessTokenVerifier } from '../src/auth/entra-access-token-verifier.js';
import type { AppConfig, EntraRuntimeConfig } from '../src/config/env.js';
import type { CandidateListQuery, CandidateListResult, CandidateRepository } from '../src/domain/candidate.js';
import type { PluginSidecarIntake } from '../src/services/plugin-sidecar-intake-service.js';

const entra: EntraRuntimeConfig = {
  tenantId: '26462e96-fb51-4267-bdd9-c087d72c8df9',
  apiClientId: '03a79d54-a2a8-4a62-88ce-f1246c1d9d1d',
  requiredScope: 'TN.Sidecar.Write',
  issuer: 'https://login.microsoftonline.com/26462e96-fb51-4267-bdd9-c087d72c8df9/v2.0'
};
const config: AppConfig = { environment: 'test', host: '127.0.0.1', port: 3333, databaseUrl: 'postgres://test:test@127.0.0.1:5432/talentnexus_test', apiToken: 'test-token-that-is-long-enough', entra };
const repository: CandidateRepository = {
  async health() { return; },
  async list(_query: CandidateListQuery): Promise<CandidateListResult> { return { data: [], total: 0 }; },
  async findByIdOrCode() { return null; }
};

const { publicKey, privateKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'test-key';
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

async function token(overrides: Record<string, unknown> = {}, signer: KeyLike = privateKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { tid: entra.tenantId, ver: '2.0', oid: 'test-object-id', scp: 'TN.Sidecar.Write', ...overrides };
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer((overrides.iss as string | undefined) ?? entra.issuer)
    .setAudience((overrides.aud as string | undefined) ?? entra.apiClientId)
    .setIssuedAt(now)
    .setExpirationTime((overrides.exp as number | undefined) ?? now + 300);
  if (typeof overrides.nbf === 'number') jwt.setNotBefore(overrides.nbf);
  return jwt.sign(signer);
}

function verifier(keySet: JWTVerifyGetKey = localJwks) {
  return new MicrosoftEntraAccessTokenVerifier(entra, async () => keySet);
}

async function rejects(authorization: string | undefined, expected: 401 | 403) {
  await assert.rejects(() => verifier().verify(authorization), (error: unknown) => error instanceof EntraAccessTokenError && error.statusCode === expected);
}

test('cryptographically signed Entra v2 access token with required scope is accepted', async () => {
  const principal = await verifier().verify(`Bearer ${await token({ sub: 'stable-subject', azp: 'connector-client-id' })}`);
  assert.deepEqual(principal, { tenantId: entra.tenantId, objectId: 'test-object-id', subject: 'stable-subject', authorizedParty: 'connector-client-id', scopes: ['TN.Sidecar.Write'] });
});

test('missing bearer token is rejected with 401', async () => { await rejects(undefined, 401); });
test('malformed bearer token is rejected with 401', async () => { await rejects('Bearer not-a-jwt', 401); });
test('invalid signature is rejected with 401', async () => {
  const other = await generateKeyPair('RS256');
  await rejects(`Bearer ${await token({}, other.privateKey)}`, 401);
});
test('expired access token is rejected with 401', async () => { await rejects(`Bearer ${await token({ exp: Math.floor(Date.now() / 1000) - 60 })}`, 401); });
test('not-before access token is rejected with 401', async () => { await rejects(`Bearer ${await token({ nbf: Math.floor(Date.now() / 1000) + 120 })}`, 401); });
test('wrong issuer is rejected with 401', async () => { await rejects(`Bearer ${await token({ iss: 'https://issuer.invalid/v2.0' })}`, 401); });
test('wrong audience is rejected with 401', async () => { await rejects(`Bearer ${await token({ aud: 'api://wrong-audience' })}`, 401); });
test('wrong tenant claim is rejected with 401', async () => { await rejects(`Bearer ${await token({ tid: '00000000-0000-0000-0000-000000000000' })}`, 401); });
test('wrong token version is rejected with 401', async () => { await rejects(`Bearer ${await token({ ver: '1.0' })}`, 401); });
test('valid token without required delegated scope is rejected with 403', async () => { await rejects(`Bearer ${await token({ scp: 'User.Read' })}`, 403); });
test('multiple delegated scopes containing required scope are accepted', async () => {
  const principal = await verifier().verify(`Bearer ${await token({ scp: 'User.Read TN.Sidecar.Write profile' })}`);
  assert.deepEqual(principal.scopes, ['User.Read', 'TN.Sidecar.Write', 'profile']);
});
test('user-readable claims do not determine authorization', async () => {
  const principal = await verifier().verify(`Bearer ${await token({ email: 'ignored@example.invalid', name: 'Ignored User', preferred_username: 'ignored' })}`);
  assert.equal(principal.objectId, 'test-object-id');
});

function payload() {
  return { contractVersion: 'plugin_sidecar_intake_v1', candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '43184' }, source: { sourceKind: 'pdf', sourceSystem: 'synthetic-plugin', sourceReference: 'entra-test', sourceUrl: 'https://example.invalid/synthetic', sourceCapturedAt: '2026-08-12T00:00:00.000Z' }, plugin: { version: 'test-plugin' }, ai: { provider: null, model: null }, correlationId: 'entra-run', resume: { schemaVersion: 'standard_resume_v1', summary: 'Synthetic only' } };
}

function evidencePayload() {
  return {
    contractVersion: 'candidate_evidence_intake_v1',
    candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '43184' },
    source: { sourceKind: 'linkedin_public', sourceSystem: 'linkedin', sourceReference: null, sourceUrl: 'https://www.linkedin.com/in/controlled-profile/?trk=test', sourceCapturedAt: '2026-08-13T00:00:00.000Z' },
    capture: { method: 'connector_visible_page', connectorVersion: '5000.0.116-test', extractorVersion: 'linkedin-visible-v1', normalizationVersion: 'tn-text-nfkc-v1' },
    representation: { kind: 'connector_text', text: 'Controlled evidence content' },
    ai: {},
    correlationId: 'evidence-entra-run',
    resume: { schemaVersion: 'standard_resume_v1', summary: 'Synthetic only' }
  };
}

test('public Entra route authenticates before side-car intake and remains PII-safe on auth failure', async () => {
  let calls = 0;
  const sidecar = { async intake() { calls += 1; return { status: 'created', candidateId: 'candidate-uuid', snapshot: { id: 'snapshot-uuid', schemaVersion: 'plugin_sidecar_intake_v1', correlationId: 'entra-run' } }; } } as unknown as PluginSidecarIntake;
  const app = buildApp(config, repository, sidecar, { entraVerifier: verifier() });
  const denied = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/candidate-enrichment', payload: { ...payload(), resume: { name: 'MUST NOT LEAK' } } });
  assert.equal(denied.statusCode, 401);
  assert.equal(JSON.stringify(denied.json()).includes('MUST NOT LEAK'), false);
  assert.equal(calls, 0);
  const allowed = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/candidate-enrichment', headers: { authorization: `Bearer ${await token()}` }, payload: payload() });
  assert.equal(allowed.statusCode, 201);
  assert.equal(calls, 1);
  await app.close();
});

test('public Entra route rejects internal TN bearer while internal route preserves TN bearer behavior', async () => {
  let calls = 0;
  const sidecar = { async intake() { calls += 1; return { status: 'created', candidateId: 'candidate-uuid', snapshot: { id: 'snapshot-uuid', schemaVersion: 'plugin_sidecar_intake_v1', correlationId: 'entra-run' } }; } } as unknown as PluginSidecarIntake;
  const app = buildApp(config, repository, sidecar, { entraVerifier: verifier() });
  const publicWithInternalToken = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/candidate-enrichment', headers: { authorization: `Bearer ${config.apiToken}` }, payload: payload() });
  assert.equal(publicWithInternalToken.statusCode, 401);
  const internal = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', headers: { authorization: `Bearer ${config.apiToken}` }, payload: payload() });
  assert.equal(internal.statusCode, 201);
  assert.equal(calls, 1);
  await app.close();
});

test('public evidence route enforces Entra before accepting a sanitized evidence envelope', async () => {
  let calls = 0;
  const evidenceIntake = { async intake() { calls += 1; return { status: 'created' as const, candidateId: 'candidate-uuid', evidenceId: 'evidence-uuid', contentSha256: 'a'.repeat(64), snapshotId: 'snapshot-uuid', processingStatus: 'completed' as const }; } };
  const app = buildApp(config, repository, undefined, { entraVerifier: verifier(), evidenceIntake });
  const denied = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/candidate-evidence', payload: evidencePayload() });
  assert.equal(denied.statusCode, 401);
  assert.equal(calls, 0);
  const allowed = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/candidate-evidence', headers: { authorization: `Bearer ${await token()}` }, payload: evidencePayload() });
  assert.equal(allowed.statusCode, 201);
  assert.equal(calls, 1);
  assert.equal(allowed.body.includes('Controlled evidence content'), false);
  await app.close();
});
