import type { DatabasePool } from '../db/pool.js';
import type { PluginSidecarIntakeV1 } from '../domain/plugin-sidecar-intake.js';
import { PinpinSourceAdapter, type PinpinCandidateSnapshot } from '../pinpin/source-adapter.js';
import { PinpinToTalentNexusReconciler, type ReconcileResult } from '../pinpin/tn-reconciler.js';
import { PluginSidecarIntakeError, PluginSidecarIntakeService, type PluginSidecarIntake, type PluginSidecarIntakeResult } from './plugin-sidecar-intake-service.js';

type TargetedPinpinReader = Pick<PinpinSourceAdapter, 'readCandidate' | 'close'>;
type TargetedReconciler = Pick<PinpinToTalentNexusReconciler, 'reconcileCandidate'>;

export type TargetedPinpinSidecarResult = PluginSidecarIntakeResult & {
  baseline: Pick<ReconcileResult, 'candidateCreated' | 'materiallyChanged' | 'candidateCode'>;
};

export class TargetedPinpinSidecarService implements PluginSidecarIntake {
  constructor(
    private readonly database: DatabasePool,
    private readonly enrichmentIntake: PluginSidecarIntake = new PluginSidecarIntakeService(database),
    private readonly readerFactory: () => Promise<TargetedPinpinReader> = () => PinpinSourceAdapter.connect(),
    private readonly reconcilerFactory: (database: DatabasePool) => TargetedReconciler = (database) => new PinpinToTalentNexusReconciler(database)
  ) {}

  async intake(request: PluginSidecarIntakeV1): Promise<TargetedPinpinSidecarResult> {
    const sourceId = Number(request.candidateRef.externalCandidateId);
    if (!/^\d+$/.test(request.candidateRef.externalCandidateId) || !Number.isSafeInteger(sourceId) || sourceId < 1) {
      throw new PluginSidecarIntakeError('SIDECAR_CANDIDATE_NOT_FOUND');
    }
    let reader: TargetedPinpinReader | undefined;
    let snapshot: PinpinCandidateSnapshot | null = null;
    try {
      reader = await this.readerFactory();
      snapshot = await reader.readCandidate(sourceId);
    } catch {
      throw new PluginSidecarIntakeError('SIDECAR_INTERNAL_ERROR');
    } finally {
      if (reader) await reader.close().catch(() => undefined);
    }
    if (!snapshot || snapshot.externalCandidateId !== request.candidateRef.externalCandidateId) {
      throw new PluginSidecarIntakeError('SIDECAR_CANDIDATE_NOT_FOUND');
    }
    let baseline: ReconcileResult;
    try {
      baseline = await this.reconcilerFactory(this.database).reconcileCandidate(snapshot);
    } catch {
      throw new PluginSidecarIntakeError('SIDECAR_INTERNAL_ERROR');
    }
    const enrichment = await this.enrichmentIntake.intake(request);
    return {
      ...enrichment,
      baseline: { candidateCreated: baseline.candidateCreated, materiallyChanged: baseline.materiallyChanged, candidateCode: baseline.candidateCode }
    };
  }
}
