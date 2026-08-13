import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabasePool } from '../src/db/pool.js';
import type { PluginSidecarIntakeV1 } from '../src/domain/plugin-sidecar-intake.js';
import type { PinpinCandidateSnapshot } from '../src/pinpin/source-adapter.js';
import { TargetedPinpinSidecarService } from '../src/services/targeted-pinpin-sidecar-service.js';
import { PluginSidecarIntakeError, type PluginSidecarIntake } from '../src/services/plugin-sidecar-intake-service.js';

const request: PluginSidecarIntakeV1 = {
  schemaVersion: '1.0',
  correlationId: '00000000-0000-4000-8000-000000000001',
  candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '90001' },
  source: { sourceSystem: 'pinpin', sourceKind: 'plugin', sourceReference: '90001', sourceUrl: null, sourceCapturedAt: null },
  plugin: { version: 'test' }, ai: { provider: 'gemini', model: 'test', promptVersion: 'test', schemaVersion: '1.0' },
  resume: { schemaVersion: '1.0', candidate: { name: 'TN SYSTEM TEST', phone: null, email: null, location: null }, currentEmployment: { company: null, title: null }, recruiterSummary: null, targetRoles: [], coreKeywords: [], experience: [], education: [], skills: [], languages: [] }
};

function snapshot(): PinpinCandidateSnapshot {
  return { externalCandidateId: '90001', displayName: 'TN SYSTEM TEST', sourceActive: true, core: {}, work: [], educations: [], documents: [], deleted: false } as unknown as PinpinCandidateSnapshot;
}

test('public targeted side-car reads exactly one Pinpin candidate, reconciles baseline, then enriches', async () => {
  const calls: string[] = [];
  const enrichment: PluginSidecarIntake = { async intake(value) { calls.push('enrichment:' + value.candidateRef.externalCandidateId); return { status: 'created', candidateId: 'tn-id', snapshot: { id: 'snapshot-id', schemaVersion: '1.0', correlationId: value.correlationId } }; } };
  const service = new TargetedPinpinSidecarService({} as DatabasePool, enrichment,
    async () => ({ async readCandidate(id) { calls.push('read:' + id); return snapshot(); }, async close() { calls.push('close'); } }),
    () => ({ async reconcileCandidate(value) { calls.push('reconcile:' + value.externalCandidateId); return { candidateCreated: true, materiallyChanged: true, candidateCode: 'TN00090001' } as never; } }));
  const result = await service.intake(request);
  assert.deepEqual(calls, ['read:90001', 'close', 'reconcile:90001', 'enrichment:90001']);
  assert.equal(result.baseline.candidateCode, 'TN00090001');
});

test('targeted side-car fails closed when the exact Pinpin candidate is absent', async () => {
  const service = new TargetedPinpinSidecarService({} as DatabasePool, { async intake() { throw new Error('must not enrich'); } },
    async () => ({ async readCandidate() { return null; }, async close() { return; } }));
  await assert.rejects(() => service.intake(request), (error: unknown) => error instanceof PluginSidecarIntakeError && error.code === 'SIDECAR_CANDIDATE_NOT_FOUND');
});
