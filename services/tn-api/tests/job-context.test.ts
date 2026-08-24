import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabasePool } from '../src/db/pool.js';
import { PostgresJobContextService } from '../src/services/job-context-service.js';

test('Job Context search query prefers structured intelligence over numbered raw JD bullets', async () => {
  const database = {
    async query() {
      return { rows: [{
        id: 'job-115', externalJobId: '115', title: 'MSLP 配件工程師', client: 'Controlled Client',
        description: '1. 負責配件妥善率\\n2. 執行配件室專案', requirements: '工作內容：\\n1. 具備製程經驗',
        location: '新竹', roleFamily: 'Hardware Engineer', mustHave: ['製程', '專案管理'],
        niceToHave: ['Qualcomm'], searchTerms: ['fixture engineering'],
      }] };
    }
  } as unknown as DatabasePool;
  const query = await new PostgresJobContextService(database).searchQuery('115');
  assert.ok(query);
  assert.match(query!, /MSLP 配件工程師/);
  assert.match(query!, /製程/);
  assert.doesNotMatch(query!, /(?:^|\\n)1\\./);
  assert.doesNotMatch(query!, /(?:^|\\n)2\\./);
});
