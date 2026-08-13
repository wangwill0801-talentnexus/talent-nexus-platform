import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { EntraRuntimeConfig } from '../config/env.js';

export type EntraPrincipal = {
  tenantId: string;
  objectId: string;
  subject?: string;
  authorizedParty?: string;
  scopes: string[];
};

export class EntraAccessTokenError extends Error {
  constructor(readonly statusCode: 401 | 403, readonly code: 'ENTRA_AUTH_REQUIRED' | 'ENTRA_AUTH_INVALID' | 'ENTRA_INSUFFICIENT_SCOPE') {
    super(code);
    this.name = 'EntraAccessTokenError';
  }
}

export interface EntraAccessTokenVerifier {
  verify(authorization?: string): Promise<EntraPrincipal>;
}

type OpenIdMetadata = { issuer?: unknown; jwks_uri?: unknown };

export class MicrosoftEntraAccessTokenVerifier implements EntraAccessTokenVerifier {
  private keySet?: Promise<JWTVerifyGetKey>;

  constructor(private readonly config: EntraRuntimeConfig, private readonly keySetFactory: () => Promise<JWTVerifyGetKey> = () => this.loadRemoteKeySet()) {}

  async verify(authorization?: string): Promise<EntraPrincipal> {
    const token = this.extractBearer(authorization);
    try {
      const { payload } = await jwtVerify(token, await this.getKeySet(), {
        issuer: this.config.issuer,
        audience: this.config.apiClientId,
        algorithms: ['RS256']
      });
      if (payload.tid !== this.config.tenantId || payload.ver !== '2.0' || typeof payload.oid !== 'string' || !payload.oid) {
        throw new EntraAccessTokenError(401, 'ENTRA_AUTH_INVALID');
      }
      const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ').filter(Boolean) : [];
      if (!scopes.includes(this.config.requiredScope)) throw new EntraAccessTokenError(403, 'ENTRA_INSUFFICIENT_SCOPE');
      return {
        tenantId: payload.tid,
        objectId: payload.oid,
        subject: typeof payload.sub === 'string' ? payload.sub : undefined,
        authorizedParty: typeof payload.azp === 'string' ? payload.azp : undefined,
        scopes
      };
    } catch (error) {
      if (error instanceof EntraAccessTokenError) throw error;
      throw new EntraAccessTokenError(401, 'ENTRA_AUTH_INVALID');
    }
  }

  private extractBearer(authorization?: string): string {
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) throw new EntraAccessTokenError(401, 'ENTRA_AUTH_REQUIRED');
    return match[1]!;
  }

  private getKeySet(): Promise<JWTVerifyGetKey> {
    this.keySet ??= this.keySetFactory();
    return this.keySet;
  }

  private async loadRemoteKeySet(): Promise<JWTVerifyGetKey> {
    const metadataUrl = new URL(`https://login.microsoftonline.com/${this.config.tenantId}/v2.0/.well-known/openid-configuration`);
    const response = await fetch(metadataUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Entra OpenID metadata unavailable');
    const metadata = await response.json() as OpenIdMetadata;
    if (metadata.issuer !== this.config.issuer || typeof metadata.jwks_uri !== 'string') throw new Error('Entra OpenID metadata invalid');
    return createRemoteJWKSet(new URL(metadata.jwks_uri));
  }
}
