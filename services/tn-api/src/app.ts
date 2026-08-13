import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { EntraAccessTokenError, MicrosoftEntraAccessTokenVerifier, type EntraAccessTokenVerifier } from './auth/entra-access-token-verifier.js';
import type { AppConfig } from './config/env.js';
import type { CandidateRepository } from './domain/candidate.js';
import { pluginSidecarIntakeV1Schema } from './domain/plugin-sidecar-intake.js';
import { candidateEvidenceIntakeV1Schema } from './domain/evidence-intake.js';
import { PluginSidecarIntakeError, type PluginSidecarIntake } from './services/plugin-sidecar-intake-service.js';
import type { CandidateDataBrowser } from './services/candidate-data-browser-service.js';
import { candidateDataBrowserHtml } from './ui/candidate-data-browser.js';
import { candidateIdentifierSchema, candidateListQuerySchema } from './validation/api.js';
import { CandidateProcessingError, type CandidateProcessingService } from './services/candidate-processing-service.js';
import { HistoricalEvidenceIntakeError, type HistoricalEvidenceIntakeService } from './services/historical-evidence-intake-service.js';
import type { TalentSearchServiceContract } from './domain/talent-search.js';
import { talentSearchRequestSchema } from './validation/talent-search.js';
import type { CandidateIntelligenceServiceContract } from './services/candidate-intelligence-service.js';

function authenticated(request: { headers: { authorization?: string } }, config: AppConfig): boolean {
  return request.headers.authorization === `Bearer ${config.apiToken}`;
}

export type AppDependencies = {
  entraVerifier?: EntraAccessTokenVerifier;
  publicSidecar?: PluginSidecarIntake;
  dataBrowser?: CandidateDataBrowser;
  processing?: Pick<CandidateProcessingService,'enqueueByIdentifier'|'retryJob'|'runOne'>;
  evidenceIntake?: Pick<HistoricalEvidenceIntakeService, 'intake'>;
  talentSearch?: TalentSearchServiceContract;
  candidateIntelligence?: CandidateIntelligenceServiceContract;
};

export function buildApp(config: AppConfig, repository: CandidateRepository, sidecar?: PluginSidecarIntake, dependencies: AppDependencies = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'info',
      serializers: {
        req: () => ({}),
        res: () => ({})
      }
    },
    requestIdHeader: false,
    logController: new LogController({ disableRequestLogging: true })
  });
  const entraVerifier = dependencies.entraVerifier ?? (config.entra ? new MicrosoftEntraAccessTokenVerifier(config.entra) : undefined);

  async function intakeSidecar(request: FastifyRequest, reply: FastifyReply, intake: PluginSidecarIntake | undefined = sidecar, includeBaseline = false) {
    if (!intake) return reply.status(503).send({ error: { code: 'SIDECAR_UNAVAILABLE', message: 'Side-car intake is unavailable.' } });
    const parsed = pluginSidecarIntakeV1Schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'SIDECAR_INVALID_PAYLOAD', message: 'Invalid side-car intake payload.' } });
    try {
      const result = await intake.intake(parsed.data);
      const targeted = result as typeof result & { baseline?: { candidateCreated: boolean; materiallyChanged: boolean; candidateCode: string } };
      // Preserve the already-released internal route contract.  The public
      // Connector route alone reports the targeted baseline outcome.
      const data: Record<string, unknown> = {
        status: result.status,
        candidateId: result.candidateId,
        snapshotId: result.snapshot.id,
        schemaVersion: result.snapshot.schemaVersion,
        correlationId: result.snapshot.correlationId
      };
      if (includeBaseline) data.baseline = targeted.baseline ?? null;
      const body = { data };
      return reply.status(result.status === 'created' ? 201 : 200).send(body);
    } catch (error) {
      if (error instanceof PluginSidecarIntakeError) {
        request.log.warn({ requestId: request.id, route: request.routeOptions.url, errorCode: error.code }, 'side-car intake rejected');
        if (error.code === 'SIDECAR_CANDIDATE_NOT_FOUND') return reply.status(404).send({ error: { code: error.code, message: 'Exact candidate mapping was not found.' } });
        if (error.code === 'SIDECAR_IDENTITY_CONFLICT') return reply.status(409).send({ error: { code: error.code, message: 'Candidate identity mapping is not usable.' } });
      }
      request.log.error({ requestId: request.id, route: request.routeOptions.url, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'side-car intake failed');
      return reply.status(500).send({ error: { code: 'SIDECAR_INTERNAL_ERROR', message: 'Side-car intake could not be completed.' } });
    }
  }

  async function intakeEvidence(request: FastifyRequest, reply: FastifyReply) {
    if (!dependencies.evidenceIntake) return reply.status(503).send({ error: { code: 'EVIDENCE_INTAKE_UNAVAILABLE', message: 'Evidence intake is unavailable.' } });
    const parsed = candidateEvidenceIntakeV1Schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'EVIDENCE_INVALID_PAYLOAD', message: 'Invalid evidence intake payload.' } });
    try {
      const result = await dependencies.evidenceIntake.intake(parsed.data);
      return reply.status(result.status === 'created' ? 201 : 200).send({ data: result });
    } catch (error) {
      if (error instanceof HistoricalEvidenceIntakeError) {
        request.log.warn({ requestId: request.id, route: request.routeOptions.url, errorCode: error.code }, 'evidence intake rejected');
        const status = error.code === 'EVIDENCE_CANDIDATE_NOT_FOUND' ? 404 : error.code === 'EVIDENCE_IDENTITY_CONFLICT' ? 409 : 400;
        return reply.status(status).send({ error: { code: error.code, message: 'Evidence could not be safely accepted.' } });
      }
      throw error;
    }
  }

  app.addHook('onResponse', async (request, reply) => {
    app.log.info({ requestId: request.id, route: request.routeOptions.url, statusCode: reply.statusCode, responseTime: reply.elapsedTime }, 'request completed');
  });

  app.setErrorHandler((error, request, reply) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    request.log.error({ requestId: request.id, route: request.routeOptions.url, errorName }, 'request failed');
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.' } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await repository.health();
      return reply.send({ data: { status: 'ok', service: 'tn-api', version: '0.1.0', database: 'connected' } });
    } catch {
      return reply.status(503).send({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connectivity is unavailable.' } });
    }
  });

  app.get('/api/v1/candidates', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    const parsed = candidateListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid list query.' } });
    const result = await repository.list(parsed.data);
    return reply.send({
      data: result.data,
      pagination: { limit: parsed.data.limit, offset: parsed.data.offset, total: result.total, hasMore: parsed.data.offset + result.data.length < result.total }
    });
  });

  app.get('/api/v1/candidates/:idOrCode', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    const idOrCode = (request.params as { idOrCode?: string }).idOrCode ?? '';
    const parsed = candidateIdentifierSchema.safeParse(idOrCode);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid candidate identifier.' } });
    const candidate = await repository.findByIdOrCode(parsed.data);
    if (!candidate) return reply.status(404).send({ error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate was not found.' } });
    return reply.send({ data: candidate });
  });

  app.get('/internal/data-browser', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(candidateDataBrowserHtml);
  });

  app.get('/internal/data-browser/candidates/:identifier', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    if (!dependencies.dataBrowser) return reply.status(503).send({ error: { code: 'DATA_BROWSER_UNAVAILABLE', message: 'Data browser is unavailable.' } });
    const identifier = String((request.params as { identifier?: string }).identifier ?? '').trim();
    if (!/^\d{1,18}$/.test(identifier) && !/^TN\d{8,}$/.test(identifier) && !/^[0-9a-f-]{36}$/i.test(identifier)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid candidate identifier.' } });
    }
    const result = await dependencies.dataBrowser.inspect(identifier);
    if (!result) return reply.status(404).send({ error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate was not found or identity was ambiguous.' } });
    return reply.send({ data: result });
  });

  app.post('/internal/data-browser/candidates/:identifier/processing', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    if (!dependencies.processing) return reply.status(503).send({ error: { code: 'PROCESSING_UNAVAILABLE', message: 'Processing is unavailable.' } });
    const identifier=String((request.params as {identifier?:string}).identifier??'').trim();
    const operation=(request.body as {operation?:string}|null)?.operation;
    if((!/^\d{1,18}$/.test(identifier)&&!/^TN\d{8,}$/.test(identifier)&&!/^[0-9a-f-]{36}$/i.test(identifier))||!['process_new_evidence','reprocess_profile','rebuild_projection'].includes(operation??'')) return reply.status(400).send({error:{code:'VALIDATION_ERROR',message:'Invalid processing request.'}});
    try{const result=await dependencies.processing.enqueueByIdentifier(identifier,operation as 'process_new_evidence'|'reprocess_profile'|'rebuild_projection');return reply.status(result.status==='created'?202:200).send({data:{status:result.status,jobId:result.job.id,jobStatus:result.job.status,operation:result.job.operation}});}catch(error){if(error instanceof CandidateProcessingError){const status=error.code==='CANDIDATE_NOT_FOUND'?404:409;return reply.status(status).send({error:{code:error.code,message:'Processing request could not be safely scheduled.'}});}throw error;}
  });

  app.post('/internal/data-browser/processing/:jobId/retry', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    if (!dependencies.processing) return reply.status(503).send({ error: { code: 'PROCESSING_UNAVAILABLE', message: 'Processing is unavailable.' } });
    const jobId=String((request.params as {jobId?:string}).jobId??'');
    if(!/^[0-9a-f-]{36}$/i.test(jobId))return reply.status(400).send({error:{code:'VALIDATION_ERROR',message:'Invalid processing job.'}});
    const retried=await dependencies.processing.retryJob(jobId);
    if(!retried)return reply.status(409).send({error:{code:'JOB_NOT_RETRYABLE',message:'Processing job is not retryable.'}});
    return reply.status(202).send({data:{status:'created',jobId:retried.id,jobStatus:retried.status,operation:retried.operation}});
  });

  app.post('/internal/plugin-sidecar/v1/candidate-enrichment', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    try {
      return await intakeSidecar(request, reply);
    } catch {
      return reply.status(500).send({ error: { code: 'SIDECAR_INTERNAL_ERROR', message: 'Side-car intake could not be completed.' } });
    }
  });

  app.get('/api/v1/talent-search/coverage', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    if (!dependencies.talentSearch) return reply.status(503).send({ error: { code: 'SEARCH_UNAVAILABLE', message: 'Talent Search is unavailable.' } });
    return reply.send({ data: await dependencies.talentSearch.coverage() });
  });

  app.post('/api/v1/talent-search', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    if (!dependencies.talentSearch) return reply.status(503).send({ error: { code: 'SEARCH_UNAVAILABLE', message: 'Talent Search is unavailable.' } });
    const parsed = talentSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid structured search criteria.' } });
    return reply.send({ data: await dependencies.talentSearch.search(parsed.data) });
  });

  app.get('/api/v1/candidate-intelligence/:identifier', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    if (!dependencies.candidateIntelligence) return reply.status(503).send({ error: { code: 'CANDIDATE_INTELLIGENCE_UNAVAILABLE', message: 'Candidate Intelligence is unavailable.' } });
    const identifier = String((request.params as { identifier?: string }).identifier ?? '').trim();
    if (!/^\d{1,18}$/.test(identifier) && !/^TN\d{8,}$/.test(identifier) && !/^[0-9a-f-]{36}$/i.test(identifier)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid candidate identifier.' } });
    }
    const candidate = await dependencies.candidateIntelligence.get(identifier);
    if (!candidate) return reply.status(404).send({ error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate was not found.' } });
    return reply.send({ data: candidate });
  });

  app.post('/internal/plugin-sidecar/v1/candidate-evidence', async (request, reply) => {
    if (!authenticated(request, config)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } });
    return intakeEvidence(request, reply);
  });

  app.post('/api/v1/plugin-sidecar/candidate-enrichment', async (request, reply) => {
    if (!entraVerifier) return reply.status(503).send({ error: { code: 'ENTRA_AUTH_UNAVAILABLE', message: 'Entra authentication is unavailable.' } });
    try {
      await entraVerifier.verify(request.headers.authorization);
    } catch (error) {
      if (error instanceof EntraAccessTokenError) {
        const message = error.statusCode === 403 ? 'Required delegated scope is missing.' : 'Valid Entra authentication is required.';
        return reply.status(error.statusCode).send({ error: { code: error.code, message } });
      }
      return reply.status(401).send({ error: { code: 'ENTRA_AUTH_INVALID', message: 'Valid Entra authentication is required.' } });
    }
    return intakeSidecar(request, reply, dependencies.publicSidecar ?? sidecar, true);
  });

  app.post('/api/v1/plugin-sidecar/candidate-evidence', async (request, reply) => {
    if (!entraVerifier) return reply.status(503).send({ error: { code: 'ENTRA_AUTH_UNAVAILABLE', message: 'Entra authentication is unavailable.' } });
    try {
      await entraVerifier.verify(request.headers.authorization);
    } catch (error) {
      if (error instanceof EntraAccessTokenError) {
        const message = error.statusCode === 403 ? 'Required delegated scope is missing.' : 'Valid Entra authentication is required.';
        return reply.status(error.statusCode).send({ error: { code: error.code, message } });
      }
      return reply.status(401).send({ error: { code: 'ENTRA_AUTH_INVALID', message: 'Valid Entra authentication is required.' } });
    }
    return intakeEvidence(request, reply);
  });

  return app;
}
