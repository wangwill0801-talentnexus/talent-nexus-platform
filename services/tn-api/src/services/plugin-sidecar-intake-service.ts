import type { DatabasePool } from '../db/pool.js';
import type { PluginSidecarIntakeV1 } from '../domain/plugin-sidecar-intake.js';
import { CandidateEnrichmentService, type StoreCandidateEnrichmentResult } from './candidate-enrichment-service.js';

export type PluginSidecarIntakeResult = StoreCandidateEnrichmentResult & { candidateId: string };

export class PluginSidecarIntakeError extends Error {
  public constructor(readonly code: 'SIDECAR_CANDIDATE_NOT_FOUND' | 'SIDECAR_IDENTITY_CONFLICT' | 'SIDECAR_INTERNAL_ERROR') {
    super(code);
  }
}

export interface PluginSidecarIntake {
  intake(request: PluginSidecarIntakeV1): Promise<PluginSidecarIntakeResult>;
}

export class PluginSidecarIntakeService implements PluginSidecarIntake {
  private readonly enrichment: CandidateEnrichmentService;

  public constructor(private readonly database: DatabasePool, enrichment = new CandidateEnrichmentService(database)) {
    this.enrichment = enrichment;
  }

  async intake(request: PluginSidecarIntakeV1): Promise<PluginSidecarIntakeResult> {
    const match = await this.database.query<{ candidate_id: string }>(`
      SELECT reference.candidate_id
      FROM candidate_external_refs reference
      JOIN source_instances source ON source.id = reference.source_instance_id
      WHERE source.source_system = $1
        AND source.instance_key = $2
        AND reference.external_candidate_id = $3
      LIMIT 2
    `, [request.candidateRef.sourceSystem, request.candidateRef.sourceInstance, request.candidateRef.externalCandidateId]);
    if (match.rows.length === 0) throw new PluginSidecarIntakeError('SIDECAR_CANDIDATE_NOT_FOUND');
    if (match.rows.length !== 1) throw new PluginSidecarIntakeError('SIDECAR_IDENTITY_CONFLICT');
    const candidateId = match.rows[0]!.candidate_id;
    try {
      const result = await this.enrichment.storeCandidateEnrichment({
        candidateId,
        source: {
          kind: request.source.sourceKind,
          system: request.source.sourceSystem,
          reference: request.source.sourceReference,
          url: request.source.sourceUrl,
          capturedAt: request.source.sourceCapturedAt,
          createdAt: request.source.sourceCreatedAt,
          updatedAt: request.source.sourceUpdatedAt,
          attachmentName: request.source.attachmentName,
          attachmentType: request.source.attachmentType,
          attachmentReference: request.source.attachmentReference,
          contentSha256: request.source.contentSha256
        },
        pluginVersion: request.plugin.version,
        parserVersion: request.plugin.parserVersion,
        atsSavedAt: request.ats.savedAt,
        aiMetadata: request.ai,
        correlationId: request.correlationId,
        payload: request.resume
      });
      return { ...result, candidateId };
    } catch (error) {
      if (error instanceof Error && error.message === 'CANDIDATE_NOT_FOUND') throw new PluginSidecarIntakeError('SIDECAR_CANDIDATE_NOT_FOUND');
      throw error;
    }
  }
}
