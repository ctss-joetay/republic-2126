/* The gzip cache in server.js is an optimisation with teeth: 50 phones polling
   one unchanged room should cost one gzip between them, not fifty. It was
   keyed on the response's ETag tag ALONE and never looked at the body, which
   is safe only while "nothing changes without room.rev advancing" holds — and
   the tests that exist to police that rule are exactly the ones the cache
   switched off, because every refusal path in server.js returns before
   bump(room).

   Concretely: two /api/state calls straddling a refused write share a tag, so
   the second call was served the FIRST call's compressed bytes. If the refusal
   had leaked a mutation, the test looking for it saw the pre-mutation JSON and
   passed. Two shipped checks were confirmed blind this way — hall-build's
   "an overspending plan reverts the whole save" and programmes' "buying the
   same programme twice is refused" both still passed with their guards
   sabotaged.

   So the cache has to be content-aware: same tag AND same bytes is a hit,
   same tag with different bytes is a miss. This file pins both halves —
   the correctness one and the optimisation it must not cost. gzip() is pulled
   out of the shipped server.js rather than retyped, so a regression there
   fails here. */
const assert = require('assert');
const zlib = require('zlib');
const path = require('path');
const { loadFn } = require('./helpers');

const SRV_FILE = path.join(__dirname, '..', 'server.js');

/* GZ is a module-level Map in server.js. Handing in a fresh one per case
   isolates the cases from each other and from insertion order. */
const makeGzip = () => loadFn('gzip', { zlib, GZ: new Map() }, SRV_FILE);

const unzip = buf => zlib.gunzipSync(buf).toString('utf8');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

/* 1. The bug itself. Same tag, different body — the second call must get the
      second body back, not the first one's bytes. */
{
  const gzip = makeGzip();
  const tag = '"s7788-abc-4"';
  const first = gzip(Buffer.from('{"coins":10}', 'utf8'), tag);
  const second = gzip(Buffer.from('{"coins":99}', 'utf8'), tag);

  ok(unzip(first) === '{"coins":10}', 'first body round-trips');
  ok(unzip(second) === '{"coins":99}',
     'a changed body under an unchanged tag must NOT serve the cached bytes');
}

/* 2. The optimisation survives. Same tag, byte-identical body — one gzip,
      shared. Identity, not just equality: a recompress on every poll would
      pass a deep-equal check while costing exactly what the cache exists to
      avoid. */
{
  const gzip = makeGzip();
  const tag = '"s7788-abc-4"';
  const body = Buffer.from('{"coins":10}', 'utf8');
  const first = gzip(body, tag);
  const second = gzip(Buffer.from('{"coins":10}', 'utf8'), tag);

  ok(first === second,
     'an unchanged body under an unchanged tag must be the SAME buffer, not a recompress');
}

/* 3. Different tags never collide, whatever their bodies. */
{
  const gzip = makeGzip();
  const a = gzip(Buffer.from('{"room":"AAAA"}', 'utf8'), '"s1-x-1"');
  const b = gzip(Buffer.from('{"room":"BBBB"}', 'utf8'), '"s2-x-1"');
  ok(unzip(a) === '{"room":"AAAA"}' && unzip(b) === '{"room":"BBBB"}',
     'two tags keep two entries');
}

/* 4. No tag means no caching at all — the untagged path must still compress
      the body it was handed. */
{
  const gzip = makeGzip();
  ok(unzip(gzip(Buffer.from('one', 'utf8'))) === 'one', 'untagged body compresses');
  ok(unzip(gzip(Buffer.from('two', 'utf8'))) === 'two', 'untagged bodies never share');
}

/* 5. The eviction guard still fires. GZ.clear() at 500 entries is what stops a
      long-running hall leaking a buffer per room-revision forever; storing the
      raw body beside the compressed one doubles what each entry holds, so this
      matters more now, not less. After the sweep the cache must still be
      correct — a body written before the clear must come back as itself. */
{
  const GZ = new Map();
  const gzip = loadFn('gzip', { zlib, GZ }, SRV_FILE);
  for (let i = 0; i < 520; i++) gzip(Buffer.from('{"i":' + i + '}', 'utf8'), '"t' + i + '"');
  ok(GZ.size < 500, 'the cache is swept rather than growing without bound, got ' + GZ.size);
  ok(unzip(gzip(Buffer.from('{"i":3}', 'utf8'), '"t3"')) === '{"i":3}',
     'an entry re-added after a sweep is still its own body');
}

console.log('gzip-cache: ' + pass + '/' + pass + ' PASS');
