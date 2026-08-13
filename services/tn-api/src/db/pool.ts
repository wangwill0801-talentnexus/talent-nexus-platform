import { Pool, type PoolClient, type PoolConfig } from 'pg';

export type DatabaseClient = Pick<PoolClient, 'query' | 'release'>;
export type DatabasePool = Pick<Pool, 'query' | 'end' | 'connect'>;

export function createPool(connectionString: string): Pool {
  const config: PoolConfig = {
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    maxUses: 10_000
  };
  return new Pool(config);
}
