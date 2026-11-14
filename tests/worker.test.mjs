import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

const env = { BASIC_AUTH_USERNAME: 'test-reviewer', BASIC_AUTH_PASSWORD: 'test-only-secret:with-colon' };
const auth = 'Basic ' + Buffer.from(env.BASIC_AUTH_USERNAME + ':' + env.BASIC_AUTH_PASSWORD).toString('base64');
const request = (path, header = auth, method = 'GET') => new Request('https://factory.test' + path, { method, headers: header ? { Authorization: header } : {} });

test('every production route fails closed without configured credentials', async () => {
  for (const path of ['/', '/api/overview', '/api/jobs/job_0220', '/api/export', '/favicon.svg']) {
    const res = await worker.fetch(request(path), {});
    assert.equal(res.status, 503, path);
  }
});
test('HTML, APIs, exports, and icons require valid Basic credentials', async () => {
  for (const path of ['/', '/api/overview', '/api/jobs/job_0220', '/api/export', '/favicon.svg']) {
    const res = await worker.fetch(request(path, null), env);
    assert.equal(res.status, 401, path);
    assert.match(res.headers.get('WWW-Authenticate'), /Basic/);
  }
  for (const header of ['Basic !!!!', 'Bearer test', 'Basic ' + Buffer.from('wrong:wrong').toString('base64'), 'Basic ' + Buffer.from('test-reviewer').toString('base64')]) {
    assert.equal((await worker.fetch(request('/api/overview', header), env)).status, 401);
  }
});
test('overview and job detail expose reconciled data and original evidence', async () => {
  const response = await worker.fetch(request('/api/overview'), env);
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.stats.jobs, 312);
  assert.equal(overview.stats.overdueOpen, 26);
  assert.equal(overview.stats.blockedOpen, 9);
  assert.equal(overview.stats.completed, 281);
  assert.equal(overview.stats.totalGood, 78555);
  assert.equal(overview.stats.totalScrap, 7613);
  assert.equal(overview.dataQuality.conflictingIds.length, 5);
  assert.ok(!('eventsByJob' in overview), 'Overview should not return all raw events');
  const detail = await (await worker.fetch(request('/api/jobs/job_0220'), env)).json();
  assert.equal(detail.job.blockReason, 'missing_tool');
  assert.ok(detail.events.some(e => e.event_type === 'job_blocked'));
  assert.ok(detail.blockIntervals.some(i => !i.end));
});
test('filters and CSV export agree; empty cohorts retain null rates', async () => {
  const overview = await (await worker.fetch(request('/api/overview?status=blocked'), env)).json();
  assert.equal(overview.jobs.length, 9);
  assert.ok(overview.jobs.every(j => j.blocked));
  const csv = await (await worker.fetch(request('/api/export?status=blocked'), env)).text();
  assert.equal(csv.split('\r\n').length - 1, overview.jobs.length);
  const empty = await (await worker.fetch(request('/api/overview?search=no-such-job-abc'), env)).json();
  assert.equal(empty.jobs.length, 0);
  assert.equal(empty.stats.onTimeRate, null);
  assert.equal(empty.stats.scrapRate, null);
});
test('unknown jobs, unsupported methods, and HEAD have correct HTTP behavior', async () => {
  assert.equal((await worker.fetch(request('/api/jobs/not-a-job'), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/overview', auth, 'POST'), env)).status, 405);
  const head = await worker.fetch(request('/', auth, 'HEAD'), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Cache-Control'), 'no-store');
});
