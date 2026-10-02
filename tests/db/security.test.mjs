// "Attack it before someone else does": every test here tries something a
// malicious or careless client might do and asserts the database refuses.
// Run: npm run test:db
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, createUser, as } from './harness.mjs';

let db;
const u = {}; // user ids
const s = {}; // shared state

const ok = (res, msg = 'expected success') => {
  if (res.error) assert.fail(`${msg}: ${res.error.message}`);
  return res.rows;
};
const fails = (res, pattern, msg = 'expected failure') => {
  assert.ok(res.error, `${msg}: statement succeeded`);
  if (pattern) assert.match(res.error.message, pattern, msg);
};
const none = (res, msg = 'expected zero rows') => {
  if (res.error) assert.fail(`${msg}: ${res.error.message}`);
  assert.equal(res.rows.length + (res.affected ?? 0), 0, msg);
};
const sql = (q, p) => db.query(q, p).then((r) => r.rows);

before(async () => {
  db = await createDb();
  u.alice = await createUser(db, { email: 'alice@test.dev', meta: { user_name: 'alice' } }); // creator
  u.bob = await createUser(db, { email: 'bob@test.dev', meta: { user_name: 'bob' } });       // voter
  u.carol = await createUser(db, { email: 'carol@test.dev' });                                // bystander
  u.newbie = await createUser(db, { email: 'newbie@test.dev', ageDays: 0 });
  u.unverified = await createUser(db, { email: 'unverified@test.dev', verified: false });
  u.mod = await createUser(db, { email: 'mod@test.dev' });
  await db.query(`insert into public.user_roles (user_id, role) values ($1, 'moderator')`, [u.mod]);
  s.websites = (await sql(`select id from public.categories where slug = 'websites'`))[0].id;
});

// ─────────────────────────────────────────────── defaults
test('anon cannot read private tables', async () => {
  for (const t of ['votes', 'yowkbit_wallets', 'yowkbit_ledger', 'downloads', 'notifications', 'reports', 'moderation_log',
                   'user_roles', 'license_acceptances', 'template_view_daily', 'reserved_usernames']) {
    fails(await as(db, null, `select * from public.${t} limit 1`), /permission denied/, t);
  }
});

test('clients cannot insert templates directly (RPC only)', async () => {
  fails(await as(db, u.alice, `insert into public.templates (owner_id, slug, title) values ($1, 'x-x', 'Sneaky')`, [u.alice]),
        /permission denied/);
});

test('service-only functions are not callable by users', async () => {
  fails(await as(db, u.alice, `select * from public.claim_scan_jobs(1)`), /permission denied/);
  fails(await as(db, null, `select public.refresh_hot_scores()`), /permission denied/);
  fails(await as(db, u.alice, `select public.record_views('[]')`), /permission denied/);
});

// ─────────────────────────────────────────────── profiles
test('signup trigger creates unique, valid usernames', async () => {
  const dup = await createUser(db, { email: 'alice@other.dev', meta: { user_name: 'alice' } });
  const [p] = await sql(`select username from public.profiles where id = $1`, [dup]);
  assert.notEqual(p.username, 'alice');
  assert.match(p.username, /^[A-Za-z0-9_]{3,30}$/);
  const reserved = await createUser(db, { email: 'admin@x.dev', meta: { user_name: 'admin' } });
  const [r] = await sql(`select username from public.profiles where id = $1`, [reserved]);
  assert.notEqual(r.username.toLowerCase(), 'admin');
});

test('profile: edit self, not others, not trust level, not foreign avatar', async () => {
  ok(await as(db, u.alice, `update public.profiles set display_name = 'Alice A' where id = $1`, [u.alice]));
  none(await as(db, u.alice, `update public.profiles set display_name = 'pwned' where id = $1 returning id`, [u.bob]));
  fails(await as(db, u.alice, `update public.profiles set trust_level = 3 where id = $1`, [u.alice]), /permission denied/);
  fails(await as(db, u.alice, `update public.profiles set avatar_path = $2 where id = $1`, [u.alice, `${u.bob}/a.png`]),
        /row-level security/);
  fails(await as(db, u.alice, `update public.profiles set username = 'settings' where id = $1`, [u.alice]), /reserved/);
});

test('renaming yourself works, reserved names are refused, the list stays private', async () => {
  ok(await as(db, u.carol, `update public.profiles set username = 'carol_renamed', display_name = 'Carol' where id = $1`, [u.carol]));
  fails(await as(db, u.carol, `update public.profiles set username = 'Admin' where id = $1`, [u.carol]), /reserved/, 'case trick');
  fails(await as(db, u.carol, `update public.profiles set username = 'YOWKLY' where id = $1`, [u.carol]), /reserved/, 'case trick');
  fails(await as(db, u.carol, `select * from public.reserved_usernames`), /permission denied/);
  // Sign-up handles that differ only in case get a free variant instead of failing.
  const twin = await createUser(db, { email: 'twin@test.dev', meta: { user_name: 'CAROL_RENAMED' } });
  const [p] = await sql(`select username from public.profiles where id = $1`, [twin]);
  assert.notEqual(p.username.toLowerCase(), 'carol_renamed');
  const admin = await createUser(db, { email: 'admin2@test.dev', meta: { user_name: 'Admin' } });
  const [q] = await sql(`select username from public.profiles where id = $1`, [admin]);
  assert.notEqual(q.username.toLowerCase(), 'admin');
});

test('profile links are handles only, and the cover photo must be your own file', async () => {
  const set = (col, v, uid = u.alice) => as(db, uid, `update public.profiles set ${col} = $2 where id = $1`, [uid, v]);
  ok(await set('linkedin', 'alice-anderson-123'));
  ok(await set('instagram', 'alice.designs'));
  ok(await set('youtube', 'AliceBuilds'));
  fails(await set('linkedin', 'https://evil.example/in/alice'), /check constraint/, 'URL instead of handle');
  fails(await set('instagram', 'javascript:alert(1)'), /check constraint/, 'script scheme');
  fails(await set('dribbble', 'a b'), /check constraint/, 'spaces');
  ok(await set('banner_path', `${u.alice}/cover-abc12345.webp`));
  fails(await set('banner_path', `${u.bob}/cover-abc12345.webp`), /row-level security/, 'someone else\'s cover');
  none(await as(db, u.alice, `update public.profiles set linkedin = 'hijacked' where id = $1 returning id`, [u.bob]), 'edit another profile');
  const [c] = ok(await as(db, null, `select linkedin, banner_path from public.creator_stats where id = $1`, [u.alice]));
  assert.deepEqual({ ...c }, { linkedin: 'alice-anderson-123', banner_path: `${u.alice}/cover-abc12345.webp` });
});

test('users cannot grant themselves roles', async () => {
  fails(await as(db, u.bob, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [u.bob]),
        /row-level security/);
});

// ─────────────────────────────────────────────── template lifecycle
test('unverified users cannot create templates', async () => {
  fails(await as(db, u.unverified, `select * from public.create_template('Nope', $1::smallint)`, [s.websites]),
        /Verify your email/);
});

test('create draft; others cannot see or edit it', async () => {
  const [row] = ok(await as(db, u.alice, `select * from public.create_template('Nocturne — SaaS Dashboard Kit', $1::smallint)`, [s.websites]));
  Object.assign(s, { tpl: row.template_id, ver: row.version_id });
  assert.equal(row.slug, 'nocturne-saas-dashboard-kit');
  none(await as(db, u.bob, `select id from public.templates where id = $1`, [s.tpl]), 'bob sees draft');
  none(await as(db, null, `select id from public.templates where id = $1`, [s.tpl]), 'anon sees draft');
  none(await as(db, u.bob, `update public.templates set title = 'pwned' where id = $1 returning id`, [s.tpl]));
  ok(await as(db, u.alice, `update public.templates set tagline = 'Dark-first analytics' where id = $1`, [s.tpl]));
  fails(await as(db, u.alice, `update public.templates set status = 'published' where id = $1`, [s.tpl]), /permission denied/);
  fails(await as(db, u.alice, `update public.templates set owner_id = $2 where id = $1`, [s.tpl, u.bob]), /permission denied/);
});

test('uploads: only a draft owner gets an upload path, within type, size and count limits', async () => {
  const prep = (uid, name, size, ver = s.ver) => as(db, uid, `select public.prepare_file_upload($1, $2, $3) as path`, [ver, name, size]);
  fails(await prep(u.bob, 'x.zip', 1000), /Version not found/, "someone else's version");
  fails(await prep(null, 'x.zip', 1000), /permission denied/, 'anonymous');
  fails(await prep(u.unverified, 'x.zip', 1000), /Verify your email/);
  fails(await prep(u.alice, 'setup.exe', 1000), /not allowed/);
  fails(await prep(u.alice, 'huge.zip', 300 * 1024 * 1024), /200 MB/);
  fails(await prep(u.alice, 'empty.zip', 0), /200 MB/);
  const [r] = ok(await prep(u.alice, 'Dashboard Kit.zip', 5_000_000));
  assert.match(r.path, new RegExp(`^${u.alice}/${s.tpl}/${s.ver}/[0-9a-f-]{36}\.zip$`), 'server-chosen path');
  s.zipPath = r.path;
});

test('register_file only accepts the server-issued path shape and records the signed size', async () => {
  fails(await as(db, u.bob, `select public.register_file($1, $2, 'x.zip', 1000)`, [s.ver, s.zipPath]), /Version not found/);
  fails(await as(db, u.alice, `select public.register_file($1, $2, 'x.zip', 1000)`, [s.ver, `${u.bob}/${s.tpl}/${s.ver}/11111111-1111-4111-8111-111111111111.zip`]),
        /Invalid upload path/, "someone else's prefix");
  fails(await as(db, u.alice, `select public.register_file($1, $2, 'x.zip', 1000)`, [s.ver, `${u.alice}/${s.tpl}/${s.ver}/../../evil.zip`]),
        /Invalid upload path/, 'traversal');
  fails(await as(db, u.alice, `select public.register_file($1, $2, 'evil.exe', 1000)`,
                 [s.ver, `${u.alice}/${s.tpl}/${s.ver}/11111111-1111-4111-8111-111111111111.exe`]), /not allowed/);
  const [r] = ok(await as(db, u.alice, `select public.register_file($1, $2, 'dashboard-kit.zip', 5000000) as id`, [s.ver, s.zipPath]));
  s.file = r.id;
  const [f] = await sql(`select size_bytes, source_tool, scan_status, bucket from public.template_files where id = $1`, [s.file]);
  assert.equal(Number(f.size_bytes), 5_000_000);
  assert.equal(f.source_tool, 'code');
  assert.equal(f.scan_status, 'pending');
  assert.equal(f.bucket, 'quarantine');
  fails(await as(db, u.alice, `update public.template_files set scan_status = 'clean' where id = $1`, [s.file]),
        /permission denied/, 'owner marks own file clean');
  fails(await as(db, u.bob, `select * from public.delete_draft_file($1)`, [s.file]), /File not found/, 'bob deletes alice file');
});

test('media uploads: owner-only paths, image types and 10 MB cap', async () => {
  const prep = (uid, type, size) => as(db, uid, `select public.prepare_media_upload($1, $2, $3) as path`, [s.tpl, type, size]);
  fails(await prep(u.bob, 'image/png', 1000), /Template not found/);
  fails(await prep(u.alice, 'image/svg+xml', 1000), /PNG, JPG/, 'SVG can carry script');
  fails(await prep(u.alice, 'text/html', 1000), /PNG, JPG/);
  fails(await prep(u.alice, 'image/png', 11 * 1024 * 1024), /10 MB/);
  const [r] = ok(await prep(u.alice, 'image/webp', 200_000));
  assert.match(r.path, new RegExp(`^${u.alice}/${s.tpl}/[0-9a-f-]{36}\.webp$`));
  s.coverPath = r.path;
  fails(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', 'An image', 10, 10)`,
                 [s.tpl, `${u.bob}/${s.tpl}/11111111-1111-4111-8111-111111111111.webp`]), /Invalid media path/);
});

test('publish gate refuses until every requirement is met', async () => {
  const pub = () => as(db, u.alice, `select public.publish_version($1, true) as status`, [s.ver]);
  fails(await as(db, u.alice, `select public.publish_version($1, false)`, [s.ver]), /own the rights/);
  fails(await pub(), /license/);
  ok(await as(db, u.alice, `update public.template_versions set license_code = 'MIT', changelog = 'First release' where id = $1`, [s.ver]));
  fails(await pub(), /cover/);
  const cover = s.coverPath;
  fails(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', '', 1600, 1000)`, [s.tpl, cover]),
        /alt_text/, 'empty alt text');
  ok(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', 'Dark analytics dashboard with MRR chart', 1600, 1000)`, [s.tpl, cover]));
  fails(await pub(), /malware scan/, 'file still pending');

  // Worker claims and completes the scan with the service role.
  const [job] = ok(await as(db, 'service', `select * from public.claim_scan_jobs(5)`));
  assert.equal(job.id, s.file);
  ok(await as(db, 'service', `select public.complete_scan($1, 'clean', $2, $3, '{"entries": 3}'::jsonb, '{}'::jsonb, null)`,
              [s.file, `${u.alice}/${s.tpl}/${s.ver}/dashboard-kit.zip`, 'a'.repeat(64)]));

  // Required details: a real description and at least one tag.
  fails(await pub(), /description/, 'no description');
  ok(await as(db, u.alice, `update public.templates set description = 'A dark-first analytics kit with charts, tables and settings pages.' where id = $1`, [s.tpl]));
  fails(await pub(), /tag/, 'no tags');
  const [react] = await sql(`select id from public.tags where slug = 'react'`);
  ok(await as(db, u.alice, `select public.set_template_tags($1, array[$2]::int[])`, [s.tpl, react.id]));

  const [r] = ok(await pub());
  assert.equal(r.status, 'pending_review', 'new creators go to review');
  none(await as(db, u.bob, `select id from public.templates where id = $1`, [s.tpl]), 'visible before review');
});

test('only moderators moderate, and every action is logged immutably', async () => {
  fails(await as(db, u.alice, `select public.moderate_template($1, 'approve', null)`, [s.tpl]), /Moderators only/);
  ok(await as(db, u.mod, `select public.moderate_template($1, 'approve', null)`, [s.tpl]));
  const [t] = await sql(`select status, published_at from public.templates where id = $1`, [s.tpl]);
  assert.equal(t.status, 'published');
  assert.ok(t.published_at);
  const log = ok(await as(db, u.mod, `select id, action from public.moderation_log where target_id = $1`, [s.tpl]));
  assert.equal(log[0].action, 'approve_template');
  none(await as(db, u.alice, `select id from public.moderation_log`), 'creator reads modlog');
  fails(await as(db, u.mod, `update public.moderation_log set reason = 'edited'`), /permission denied/);
  fails(await db.query(`delete from public.moderation_log`).then(() => ({ rows: [] }), (error) => ({ error })), /append-only/);
  const notes = ok(await as(db, u.alice, `select type from public.notifications`));
  assert.ok(notes.some((n) => n.type === 'upload_approved'));
});

test('search matches part of a word, ignores case, and only lists published work', async () => {
  const [t] = await sql(`select title from public.templates where id = $1`, [s.tpl]);
  const word = t.title.toLowerCase().split(/\s+/)[0];
  for (const part of [word, word.slice(0, 2), word.slice(0, 1)]) {
    const hit = ok(await as(db, null, `select id from public.template_cards where search_text ilike $1`, [`%${part}%`]));
    assert.ok(hit.some((r) => r.id === s.tpl), `"${part}" should find "${t.title}"`);
  }
  await sql(`update public.templates set status = 'draft' where id = $1`, [s.tpl]);
  none(await as(db, null, `select id from public.template_cards where id = $1`, [s.tpl]), 'anon reads an unpublished card');
  await sql(`update public.templates set status = 'published' where id = $1`, [s.tpl]);
});

test('published versions are immutable', async () => {
  none(await as(db, u.alice, `update public.template_versions set changelog = 'rewritten' where id = $1 returning id`, [s.ver]));
  fails(await db.query(`update public.template_versions set changelog = 'rewritten' where id = $1`, [s.ver])
          .then(() => ({ rows: [] }), (error) => ({ error })), /immutable/, 'even as table owner');
  none(await as(db, u.alice, `delete from public.template_files where id = $1 returning id`, [s.file]));
});

test('public sees clean file metadata but never storage paths or scan reports', async () => {
  const rows = ok(await as(db, null, `select id, original_name, manifest from public.template_files where template_id = $1`, [s.tpl]));
  assert.equal(rows.length, 1);
  fails(await as(db, null, `select storage_path from public.template_files`), /permission denied/);
  fails(await as(db, u.bob, `select scan_report from public.template_files`), /permission denied/);
});

// ─────────────────────────────────────────────── downloads
test('downloads require sign-in, license acceptance, and are counted once per day', async () => {
  fails(await as(db, null, `select * from public.begin_download($1, true)`, [s.file]), /permission denied/);
  fails(await as(db, u.bob, `select * from public.begin_download($1, false)`, [s.file]), /LICENSE_NOT_ACCEPTED/);
  const [d] = ok(await as(db, u.bob, `select * from public.begin_download($1, true)`, [s.file]));
  assert.equal(d.bucket, 'template-files');
  assert.equal(d.filename, 'nocturne-saas-dashboard-kit-v1.0.0.zip');
  assert.equal(d.license_code, 'MIT');
  ok(await as(db, u.bob, `select * from public.begin_download($1, false)`, [s.file])); // acceptance remembered
  const [st] = await sql(`select download_count from public.template_stats where template_id = $1`, [s.tpl]);
  assert.equal(st.download_count, 1);
  const mine = ok(await as(db, u.bob, `select license_code from public.downloads`));
  assert.equal(mine.length, 2);
  none(await as(db, u.carol, `select id from public.downloads`), 'carol reads bob downloads');
  fails(await as(db, u.bob, `insert into public.downloads (template_id) values ($1)`, [s.tpl]), /permission denied/);
});

// ─────────────────────────────────────────────── votes & likes
test('voting rules: no self-votes, no brand-new or unverified accounts, one vote each', async () => {
  const vote = (uid) => as(db, uid, `select * from public.cast_vote($1)`, [s.tpl]);
  fails(await vote(u.alice), /own work/, 'self vote');
  fails(await vote(u.newbie), /24 hours/, 'account created today');
  fails(await vote(u.unverified), /Verify your email/, 'unverified');
  fails(await vote(null), /permission denied/, 'anon');
  const [r] = ok(await vote(u.bob));
  assert.equal(r.balance, 99, 'a vote costs exactly one yowkbit');
  assert.equal(r.vote_count, 1);
  fails(await vote(u.bob), /already voted/, 'double vote');
  const [e] = ok(await as(db, u.bob, `select public.vote_eligibility($1) as e`, [s.tpl]));
  assert.equal(e.e, 'voted');
  const [n] = ok(await as(db, u.newbie, `select public.vote_eligibility($1) as e`, [s.tpl]));
  assert.equal(n.e, 'too_new');
});

test('voting does not depend on downloadable files: a demo-only template can be voted on', async () => {
  const [row] = ok(await as(db, u.alice, `select * from public.create_template('Demo Only — Landing Concept', $1::smallint)`, [s.websites]));
  const t = row.template_id;
  const dana = await createUser(db, { email: 'dana@test.dev' }); // a voter no other test looks at
  const [m] = ok(await as(db, u.alice, `select public.prepare_media_upload($1, 'image/webp', 100000) as path`, [t]));
  ok(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', 'Landing concept preview', 1600, 1000)`, [t, m.path]));
  ok(await as(db, u.alice, `update public.templates set demo_url = 'https://example.com/demo',
      tagline = 'A landing page concept', description = 'A one-page landing concept, shown as a live demo only.' where id = $1`, [t]));
  const [tag] = await sql(`select id from public.tags where slug = 'minimal'`);
  ok(await as(db, u.alice, `select public.set_template_tags($1, array[$2]::int[])`, [t, tag.id]));
  ok(await as(db, u.alice, `update public.template_versions set license_code = 'MIT' where id = $1`, [row.version_id]));
  assert.equal((await sql(`select count(*)::int as n from public.template_files where template_id = $1`, [t]))[0].n, 0, 'the template has no files');

  const eligibility = (uid) => as(db, uid, `select public.vote_eligibility($1) as e`, [t]).then((r) => ok(r)[0].e);
  ok(await as(db, u.alice, `select public.publish_version($1, true)`, [row.version_id]));
  assert.equal(await eligibility(dana), 'not_published', 'nobody votes before approval');
  ok(await as(db, u.mod, `select public.moderate_template($1, 'approve', null)`, [t]));

  assert.equal(await eligibility(dana), 'ok', 'no files needed to vote');
  const [v] = ok(await as(db, dana, `select * from public.cast_vote($1)`, [t]));
  assert.equal(v.vote_count, 1);
  assert.equal((await sql(`select count(*)::int as n from public.template_files where template_id = $1`, [t]))[0].n, 0);
});

test('votes cannot be forged, edited, retracted or read by others', async () => {
  fails(await as(db, u.carol, `insert into public.votes (user_id, template_id) values ($1, $2)`, [u.bob, s.tpl]),
        /permission denied/, 'direct insert as someone else');
  fails(await as(db, u.carol, `insert into public.votes (template_id) values ($1)`, [s.tpl]),
        /permission denied/, 'direct insert skipping the wallet');
  fails(await as(db, u.bob, `delete from public.votes where template_id = $1`, [s.tpl]), /permission denied/, 'retract');
  fails(await as(db, u.bob, `update public.votes set created_at = now() where template_id = $1`, [s.tpl]), /permission denied/, 'edit');
  await assert.rejects(db.query(`update public.votes set created_at = now()`), /final/, 'even the service role cannot edit a vote');
  none(await as(db, u.carol, `select * from public.votes`), 'carol reads bob vote');
});

test('yowkbits: 100 at sign-up, spent only through votes, never below zero', async () => {
  const fresh = await createUser(db, { email: 'wallet@test.dev' });
  const [w] = ok(await as(db, fresh, `select balance from public.yowkbit_wallets`));
  assert.equal(w.balance, 100);
  const [l] = ok(await as(db, fresh, `select delta, reason from public.yowkbit_ledger`));
  assert.deepEqual({ ...l }, { delta: 100, reason: 'signup_grant' });

  fails(await as(db, fresh, `update public.yowkbit_wallets set balance = 1000000`), /permission denied/, 'mint yowkbits');
  fails(await as(db, fresh, `insert into public.yowkbit_ledger (user_id, delta, reason) values ($1, 500, 'adjustment')`, [fresh]),
        /permission denied/, 'forge a ledger entry');
  none(await as(db, fresh, `select * from public.yowkbit_wallets where user_id = $1`, [u.bob]), 'read another wallet');
  none(await as(db, fresh, `select * from public.yowkbit_ledger where user_id = $1`, [u.bob]), 'read another ledger');
  await assert.rejects(db.query(`update public.yowkbit_ledger set delta = 5 where user_id = $1`, [fresh]), /append-only/);

  await db.query(`update public.yowkbit_wallets set balance = 0 where user_id = $1`, [fresh]);
  const [e] = ok(await as(db, fresh, `select public.vote_eligibility($1) as e`, [s.tpl]));
  assert.equal(e.e, 'no_bits');
  fails(await as(db, fresh, `select * from public.cast_vote($1)`, [s.tpl]), /out of yowkbits/);
  await assert.rejects(db.query(`update public.yowkbit_wallets set balance = -1 where user_id = $1`, [fresh]), /check constraint/);
});

test('vote counts and the ledger always agree', async () => {
  ok(await as(db, u.carol, `select * from public.cast_vote($1)`, [s.tpl]));
  const [st] = await sql(`select vote_count from public.template_stats where template_id = $1`, [s.tpl]);
  const [agg] = await sql(`select count(*)::int n from public.votes where template_id = $1`, [s.tpl]);
  assert.equal(st.vote_count, agg.n);
  for (const uid of [u.bob, u.carol]) {
    const [b] = await sql(`select w.balance, (select sum(delta)::int from public.yowkbit_ledger l where l.user_id = w.user_id) as ledger
                           from public.yowkbit_wallets w where w.user_id = $1`, [uid]);
    assert.equal(b.balance, b.ledger, 'wallet balance equals the sum of its ledger');
  }
});

test('likes: only published templates, only as yourself', async () => {
  ok(await as(db, u.bob, `insert into public.likes (template_id) values ($1)`, [s.tpl]));
  fails(await as(db, u.bob, `insert into public.likes (user_id, template_id) values ($1, $2)`, [u.carol, s.tpl]), /permission denied/);
  const [draft] = ok(await as(db, u.alice, `select template_id from public.create_template('Secret draft', $1::smallint)`, [s.websites]));
  s.draft = draft.template_id;
  fails(await as(db, u.bob, `insert into public.likes (template_id) values ($1)`, [s.draft]), /row-level security/);
  const [st] = await sql(`select like_count from public.template_stats where template_id = $1`, [s.tpl]);
  assert.equal(st.like_count, 1);
});

// ─────────────────────────────────────────────── comments, collections, reports
test('comments: one level of replies; edit and delete only your own', async () => {
  const [c] = ok(await as(db, u.bob, `insert into public.comments (template_id, body) values ($1, 'Clean tokens!') returning id`, [s.tpl]));
  const [r] = ok(await as(db, u.alice, `insert into public.comments (template_id, parent_id, body) values ($1, $2, 'Thanks') returning id`, [s.tpl, c.id]));
  fails(await as(db, u.carol, `insert into public.comments (template_id, parent_id, body) values ($1, $2, 'deep')`, [s.tpl, r.id]), /one level/);
  none(await as(db, u.carol, `update public.comments set body = 'pwned' where id = $1 returning id`, [c.id]));
  fails(await as(db, u.carol, `select public.delete_comment($1)`, [c.id]), /Not allowed/);
  ok(await as(db, u.bob, `update public.comments set body = 'Clean tokens, great work' where id = $1`, [c.id]));
  fails(await as(db, u.bob, `insert into public.comments (template_id, body) values ($1, 'on a draft')`, [s.draft]), /row-level security/);
  const notes = ok(await as(db, u.alice, `select type from public.notifications where type = 'comment'`));
  assert.equal(notes.length, 1);
  none(await as(db, u.bob, `select id from public.notifications where user_id = $1`, [u.alice]), 'bob reads alice notifications');
});

test('private collections are invisible and cannot be written by others', async () => {
  const [col] = ok(await as(db, u.bob, `insert into public.collections (name, is_public) values ('Secret board', false) returning id`));
  none(await as(db, u.carol, `select id from public.collections where id = $1`, [col.id]));
  fails(await as(db, u.carol, `insert into public.collection_items (collection_id, template_id) values ($1, $2)`, [col.id, s.tpl]),
        /row-level security/);
  ok(await as(db, u.bob, `insert into public.collection_items (collection_id, template_id) values ($1, $2)`, [col.id, s.tpl]));
});

test('community posts: validated, rate-limited, private likes, removal by author or moderator', async () => {
  const create = (uid, body, tags = []) => as(db, uid, `select public.create_post($1, $2::text[]) as id`, [body, tags]);

  fails(await create(u.unverified, 'hello'), /Verify your email/, 'unverified user posts');
  fails(await create(null, 'hello'), /permission denied|Sign in|not authenticated|Not signed in/i, 'anon posts');
  fails(await as(db, u.alice, `insert into public.posts (author_id, body) values ($1, 'direct')`, [u.alice]), /permission denied/, 'direct insert');

  fails(await create(u.alice, '   '), /Write something/);
  fails(await create(u.alice, 'x'.repeat(1501)), /1,500/);
  fails(await create(u.alice, 'tagged', ['a b']), /Tags are/);
  fails(await create(u.alice, 'tagged', ['one', 'two', 'three', 'four', 'five', 'six']), /up to 5/);

  const [{ id }] = ok(await create(u.alice, '  Shipped my first template!  ', ['#React', 'react', 'Design-Tips']));
  s.post = id;
  const [card] = ok(await as(db, null, `select body, tags, like_count, author_username from public.post_cards where id = $1`, [id]));
  assert.equal(card.body, 'Shipped my first template!');
  assert.deepEqual(card.tags, ['react', 'design-tips']);
  assert.equal(card.author_username, 'alice');
  fails(await create(u.alice, 'Shipped my first template!'), /already posted/, 'duplicate post');

  // Nobody edits a post in place, not even the author.
  fails(await as(db, u.alice, `update public.posts set body = 'rewritten' where id = $1`, [id]), /permission denied/);
  fails(await as(db, u.alice, `update public.posts set like_count = 999 where id = $1`, [id]), /permission denied/);

  // Likes: as yourself, once each, private to the liker, counted on the post.
  ok(await as(db, u.bob, `insert into public.post_likes (post_id) values ($1)`, [id]));
  fails(await as(db, u.bob, `insert into public.post_likes (post_id) values ($1)`, [id]), /duplicate key/, 'double like');
  fails(await as(db, u.bob, `insert into public.post_likes (post_id, user_id) values ($1, $2)`, [id, u.carol]), /permission denied/, 'like as someone else');
  assert.equal(ok(await as(db, null, `select like_count from public.post_cards where id = $1`, [id]))[0].like_count, 1);
  none(await as(db, u.alice, `select 1 from public.post_likes where user_id = $1`, [u.bob]), 'author reads who liked');
  fails(await as(db, null, `select 1 from public.post_likes`), /permission denied/, 'anon reads likes');
  none(await as(db, u.carol, `delete from public.post_likes where user_id = $1 returning 1`, [u.bob]), 'unlike as someone else');
  ok(await as(db, u.bob, `delete from public.post_likes where post_id = $1`, [id]));
  assert.equal(ok(await as(db, null, `select like_count from public.post_cards where id = $1`, [id]))[0].like_count, 0);

  // Anyone signed in can report a post; reports are private to the reporter and moderators.
  ok(await as(db, u.bob, `insert into public.reports (target_type, target_id, reason) values ('post', $1, 'spam')`, [id]));
  none(await as(db, u.carol, `select 1 from public.reports where target_id = $1`, [id]), 'bystander reads a report about a post');

  // Removal: only the author or a moderator, and moderators must say why and leave a trail.
  fails(await as(db, u.bob, `select public.delete_post($1)`, [id]), /Not allowed/);
  fails(await as(db, u.mod, `select public.delete_post($1)`, [id]), /reason is required/);
  ok(await as(db, u.mod, `select public.delete_post($1, 'spam')`, [id]));
  none(await as(db, null, `select 1 from public.post_cards where id = $1`, [id]), 'removed post still public');
  none(await as(db, u.bob, `select 1 from public.posts where id = $1`, [id]), 'others read a removed post');
  assert.equal(ok(await as(db, u.alice, `select status from public.posts where id = $1`, [id]))[0].status, 'removed');
  fails(await as(db, u.bob, `insert into public.post_likes (post_id) values ($1)`, [id]), /row-level security/, 'like a removed post');
  const log = await sql(`select action, reason from public.moderation_log where target_id = $1`, [id]);
  assert.deepEqual(log.map((l) => l.action), ['remove_post']);

  // Authors can remove their own without a reason.
  const [{ id: mine }] = ok(await create(u.alice, 'A second thought'));
  ok(await as(db, u.alice, `select public.delete_post($1)`, [mine]));
  none(await as(db, null, `select 1 from public.post_cards where id = $1`, [mine]));
});

test('post comments and dislikes: validated, limited, removable by the right people only', async () => {
  const [{ id: post }] = ok(await as(db, u.alice, `select public.create_post('Comment on me', '{}') as id`));
  const comment = (uid, id, body) => as(db, uid, `select public.create_post_comment($1, $2) as id`, [id, body]);
  const counts = async () => (await sql(`select comment_count, like_count, dislike_count from public.post_cards where id = $1`, [post]))[0];

  fails(await comment(u.unverified, post, 'hi'), /Verify your email/, 'unverified comments');
  fails(await comment(u.bob, post, '  '), /Write a comment/);
  fails(await comment(u.bob, post, 'x'.repeat(801)), /800/);
  fails(await comment(u.bob, '00000000-0000-0000-0000-000000000000', 'hi'), /Post not found/);
  fails(await as(db, u.bob, `insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'direct')`, [post, u.bob]), /permission denied/, 'direct insert');

  const [{ id: c1 }] = ok(await comment(u.bob, post, '  Nice work!  '));
  assert.equal((await counts()).comment_count, 1);
  const [card] = ok(await as(db, null, `select body, author_username from public.post_comment_cards where post_id = $1`, [post]));
  assert.equal(card.body, 'Nice work!');
  assert.equal(card.author_username, 'bob');
  fails(await comment(u.bob, post, 'Nice work!'), /already said that/, 'duplicate comment');
  fails(await as(db, u.bob, `update public.post_comments set body = 'rewritten' where id = $1`, [c1]), /permission denied/, 'edit a comment');

  // Who may remove a comment: its author, the post's author, or a moderator with a reason.
  fails(await as(db, u.carol, `select public.delete_post_comment($1)`, [c1]), /Not allowed/);
  fails(await as(db, u.mod, `select public.delete_post_comment($1)`, [c1]), /reason is required/);
  ok(await as(db, u.alice, `select public.delete_post_comment($1)`, [c1]));
  assert.equal((await counts()).comment_count, 0);
  none(await as(db, null, `select 1 from public.post_comment_cards where id = $1`, [c1]), 'removed comment still public');
  fails(await as(db, u.bob, `select public.delete_post_comment($1)`, [c1]), /not found/i, 'remove twice');

  const [{ id: c2 }] = ok(await comment(u.carol, post, 'Second opinion'));
  ok(await as(db, u.mod, `select public.delete_post_comment($1, 'abusive')`, [c2]));
  assert.deepEqual((await sql(`select action from public.moderation_log where target_id = $1`, [c2])).map((l) => l.action), ['remove_post_comment']);
  ok(await as(db, u.alice, `select public.create_post_comment($1, 'Thanks!')`, [post]));
  assert.equal((await counts()).comment_count, 1);

  // Ten comments in ten minutes is the ceiling.
  for (let i = 0; i < 8; i++) ok(await comment(u.bob, post, `burst ${i}`));
  ok(await comment(u.bob, post, 'burst 8'));
  fails(await comment(u.bob, post, 'one too many'), /Slow down/);

  // Reactions: one per person, like or dislike, switchable, private, counted.
  ok(await as(db, u.bob, `insert into public.post_likes (post_id) values ($1)`, [post]));
  ok(await as(db, u.carol, `insert into public.post_likes (post_id, kind) values ($1, 'dislike')`, [post]));
  assert.deepEqual([(await counts()).like_count, (await counts()).dislike_count], [1, 1]);
  fails(await as(db, u.mod, `insert into public.post_likes (post_id, kind) values ($1, 'love')`, [post]), /violates check|invalid/, 'unknown reaction');
  ok(await as(db, u.bob, `update public.post_likes set kind = 'dislike' where post_id = $1`, [post]));
  assert.deepEqual([(await counts()).like_count, (await counts()).dislike_count], [0, 2]);
  none(await as(db, u.alice, `update public.post_likes set kind = 'like' where user_id = $1 returning 1`, [u.bob]), 'switch someone else\'s reaction');
  fails(await as(db, u.bob, `update public.post_likes set user_id = $1 where post_id = $2`, [u.carol, post]), /permission denied/, 'hand a reaction to someone else');
  ok(await as(db, u.bob, `delete from public.post_likes where post_id = $1`, [post]));
  ok(await as(db, u.carol, `delete from public.post_likes where post_id = $1`, [post]));
  assert.deepEqual([(await counts()).like_count, (await counts()).dislike_count], [0, 0]);

  // A removed post takes no new comments.
  ok(await as(db, u.alice, `select public.delete_post($1)`, [post]));
  fails(await comment(u.carol, post, 'too late'), /Post not found/);
});

test('comment reactions and previews: one reaction each, private, counted; previews are the best two', async () => {
  const [{ id: post }] = ok(await as(db, u.alice, `select public.create_post('Preview me', '{}') as id`));
  const comment = async (uid, body) => ok(await as(db, uid, `select public.create_post_comment($1, $2) as id`, [post, body]))[0].id;
  const c1 = await comment(u.mod, 'first');
  const c2 = await comment(u.carol, 'second');
  const c3 = await comment(u.alice, 'third');
  const counts = async (id) => (await sql(`select like_count, dislike_count from public.post_comments where id = $1`, [id]))[0];

  ok(await as(db, u.bob, `insert into public.post_comment_likes (comment_id) values ($1)`, [c2]));
  ok(await as(db, u.alice, `insert into public.post_comment_likes (comment_id) values ($1)`, [c2]));
  ok(await as(db, u.carol, `insert into public.post_comment_likes (comment_id, kind) values ($1, 'dislike')`, [c1]));
  assert.deepEqual(Object.values(await counts(c2)), [2, 0]);
  assert.deepEqual(Object.values(await counts(c1)), [0, 1]);

  fails(await as(db, u.bob, `insert into public.post_comment_likes (comment_id) values ($1)`, [c2]), /duplicate key/, 'react twice');
  fails(await as(db, u.bob, `insert into public.post_comment_likes (comment_id, user_id) values ($1, $2)`, [c3, u.carol]), /permission denied/, 'react as someone else');
  fails(await as(db, u.mod, `insert into public.post_comment_likes (comment_id, kind) values ($1, 'love')`, [c3]), /violates check|invalid/, 'unknown reaction');
  fails(await as(db, null, `select 1 from public.post_comment_likes`), /permission denied/, 'anon reads reactions');
  none(await as(db, u.alice, `select 1 from public.post_comment_likes where user_id = $1`, [u.bob]), 'read someone else\'s reaction');
  ok(await as(db, u.bob, `update public.post_comment_likes set kind = 'dislike' where comment_id = $1`, [c2]));
  assert.deepEqual(Object.values(await counts(c2)), [1, 1]);
  none(await as(db, u.carol, `update public.post_comment_likes set kind = 'like' where user_id = $1 returning 1`, [u.bob]), 'switch someone else\'s reaction');
  ok(await as(db, u.bob, `delete from public.post_comment_likes where comment_id = $1`, [c2]));
  assert.deepEqual(Object.values(await counts(c2)), [1, 0]);

  // Previews: at most two per post, best first, removed comments never included.
  const previews = async (per) => ok(await as(db, null, `select id, like_count from public.post_comment_previews(array[$1]::uuid[], $2)`, [post, per]));
  assert.deepEqual((await previews(2)).map((r) => r.id), [c2, c3]);   // c2 has +1, then the newest of the rest
  assert.equal((await previews(99)).length, 3, 'capped at three per post');
  ok(await as(db, u.carol, `select public.delete_post_comment($1)`, [c2]));
  assert.deepEqual((await previews(2)).map((r) => r.id), [c3, c1]);   // c1 is at -1, c3 at 0
  assert.ok(!(await previews(3)).some((r) => r.id === c2), 'removed comment in previews');
  fails(await as(db, u.bob, `insert into public.post_comment_likes (comment_id) values ($1)`, [c2]), /row-level security/, 'react to a removed comment');
});

test('sub-admins: granted by an admin to a friend, may only approve or request changes; staff are notified', async () => {
  const boss = await createUser(db, { email: 'boss@test.dev' });
  const fan = await createUser(db, { email: 'fan@test.dev' });
  const stranger = await createUser(db, { email: 'stranger@test.dev' });
  const maker = await createUser(db, { email: 'maker@test.dev' });
  await sql(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [boss]);
  ok(await as(db, fan, `insert into public.follows (followee_id) values ($1)`, [boss]));

  // Only admins grant it, only to their followers, and nobody grants it to themselves.
  fails(await as(db, u.mod, `select public.set_sub_admin($1, true)`, [fan]), /Admins only/);
  fails(await as(db, fan, `select public.set_sub_admin($1, true)`, [fan]), /Admins only/);
  fails(await as(db, boss, `select public.set_sub_admin($1, true)`, [stranger]), /Only friends/);
  fails(await as(db, boss, `select public.set_sub_admin($1, true)`, [fan]), /Only friends/, 'a follower the admin does not follow back');
  ok(await as(db, boss, `insert into public.follows (followee_id) values ($1)`, [fan]));
  ok(await as(db, boss, `select public.set_sub_admin($1, true)`, [fan]));
  assert.equal(ok(await as(db, fan, `select public.my_staff_role() as r`))[0].r, 'reviewer');
  assert.equal(ok(await as(db, stranger, `select public.my_staff_role() as r`))[0].r, null);
  const cands = ok(await as(db, boss, `select id, is_sub_admin from public.sub_admin_candidates()`));
  assert.ok(cands.some((c) => c.id === fan && c.is_sub_admin));
  none(await as(db, fan, `select id from public.sub_admin_candidates()`), 'non-admin lists candidates');
  fails(await as(db, fan, `insert into public.user_roles (user_id, role) values ($1, 'moderator')`, [fan]), /row-level security/, 'promote yourself');

  // A new creator's upload goes to review, and every staff member hears about it.
  const [row] = ok(await as(db, maker, `select * from public.create_template('Review Me Kit', $1::smallint)`, [s.websites]));
  const t = row.template_id;
  const [m] = ok(await as(db, maker, `select public.prepare_media_upload($1, 'image/webp', 100000) as path`, [t]));
  ok(await as(db, maker, `select public.register_media($1, $2, 'cover', 'desktop', 'Kit preview', 1600, 1000)`, [t, m.path]));
  ok(await as(db, maker, `update public.templates set demo_url = 'https://review-me.vercel.app', tagline = 'A kit to review',
      description = 'A small kit that needs a moderator to look at it first.' where id = $1`, [t]));
  ok(await as(db, maker, `update public.template_versions set license_code = 'MIT' where id = $1`, [row.version_id]));
  const [tag] = await sql(`select id from public.tags where slug = 'minimal'`);
  ok(await as(db, maker, `select public.set_template_tags($1, array[$2]::int[])`, [t, tag.id]));
  assert.equal(ok(await as(db, maker, `select public.publish_version($1, true) as s`, [row.version_id]))[0].s, 'pending_review');
  for (const staff of [boss, fan, u.mod]) {
    const n = ok(await as(db, staff, `select read_at from public.notifications where type = 'review_needed' and template_id = $1`, [t]));
    assert.equal(n.length, 1, 'staff member notified');
    assert.equal(n[0].read_at, null);
  }
  none(await as(db, stranger, `select 1 from public.notifications where type = 'review_needed'`), 'non-staff notified');

  // The sub-admin sees the queue, can reject and approve, and can do nothing else.
  assert.equal(ok(await as(db, fan, `select id from public.template_cards where id = $1`, [t])).length, 1, 'sub-admin sees the pending template');
  none(await as(db, stranger, `select id from public.template_cards where id = $1`, [t]), 'stranger sees it');
  fails(await as(db, fan, `select public.moderate_template($1, 'remove', 'not allowed')`, [t]), /Moderators only/, 'sub-admin removes');
  fails(await as(db, fan, `select public.resolve_report($1, 'dismissed', null)`, ['00000000-0000-0000-0000-000000000000']), /Moderators only/, 'sub-admin resolves reports');
  none(await as(db, fan, `select 1 from public.moderation_log`), 'sub-admin reads the audit log');
  none(await as(db, fan, `select 1 from public.reports`), 'sub-admin reads reports');
  ok(await as(db, fan, `select public.moderate_template($1, 'approve', null)`, [t]));
  assert.equal((await sql(`select status from public.templates where id = $1`, [t]))[0].status, 'published');
  const after = ok(await as(db, boss, `select read_at from public.notifications where type = 'review_needed' and template_id = $1`, [t]));
  assert.ok(after[0].read_at, 'review pings are cleared once it is reviewed');

  // Taking it away works, and then the queue is out of reach again.
  ok(await as(db, boss, `select public.set_sub_admin($1, false)`, [fan]));
  assert.equal(ok(await as(db, fan, `select public.my_staff_role() as r`))[0].r, null);
  const log = await sql(`select action from public.moderation_log where target_id = $1 order by id`, [fan]);
  assert.deepEqual(log.map((l) => l.action), ['grant_sub_admin', 'revoke_sub_admin']);
});

test('Inspo is showcase only: no files or source links, Showcase license, and it can be voted on', async () => {
  const maker = await createUser(db, { email: 'inspo@test.dev' });
  const voter = await createUser(db, { email: 'inspo-fan@test.dev' });
  await sql(`update public.profiles set trust_level = 1 where id = $1`, [maker]);
  const [inspo] = await sql(`select id from public.categories where slug = 'inspo-websites'`);
  const [row] = ok(await as(db, maker, `select * from public.create_template('My Portfolio Site', $1::smallint)`, [inspo.id]));
  const t = row.template_id, v = row.version_id;

  fails(await as(db, maker, `select public.prepare_file_upload($1, 'site.zip', 1000)`, [v])
          .then((r) => (r.error ? r : as(db, maker, `select public.register_file($1, $2, 'site.zip', 1000)`, [v, r.rows[0].prepare_file_upload]))),
        /showcase only/i, 'file on an Inspo template');
  fails(await as(db, maker, `insert into public.template_links (template_id, kind, url) values ($1, 'github', 'https://github.com/a/b')`, [t]),
        /showcase only/i, 'source link on an Inspo template');

  const [m] = ok(await as(db, maker, `select public.prepare_media_upload($1, 'image/webp', 100000) as path`, [t]));
  ok(await as(db, maker, `select public.register_media($1, $2, 'cover', 'desktop', 'Portfolio home page', 1600, 1000)`, [t, m.path]));
  ok(await as(db, maker, `update public.templates set demo_url = 'https://maker.vercel.app', tagline = 'My personal portfolio',
      description = 'A portfolio site I designed and built, shared for inspiration.' where id = $1`, [t]));
  const [tag] = await sql(`select id from public.tags where slug = 'minimal'`);
  ok(await as(db, maker, `select public.set_template_tags($1, array[$2]::int[])`, [t, tag.id]));

  ok(await as(db, maker, `update public.template_versions set license_code = 'MIT' where id = $1`, [v]));
  fails(await as(db, maker, `select public.publish_version($1, true)`, [v]), /Showcase only/, 'Inspo with a download license');
  ok(await as(db, maker, `update public.template_versions set license_code = 'SHOWCASE' where id = $1`, [v]));
  assert.equal(ok(await as(db, maker, `select public.publish_version($1, true) as s`, [v]))[0].s, 'published');
  const [card] = ok(await as(db, null, `select category_kind, license_code from public.template_cards where id = $1`, [t]));
  assert.deepEqual([card.category_kind, card.license_code], ['inspo', 'SHOWCASE']);
  ok(await as(db, voter, `select * from public.cast_vote($1)`, [t]));

  // A normal template can't borrow the showcase license, and one with files can't move into Inspo.
  const [row2] = ok(await as(db, u.alice, `select * from public.create_template('Not Inspo', $1::smallint)`, [s.websites]));
  ok(await as(db, u.alice, `insert into public.template_links (template_id, kind, url) values ($1, 'github', 'https://github.com/a/b')`, [row2.template_id]));
  fails(await as(db, u.alice, `update public.templates set category_id = $2 where id = $1`, [row2.template_id, inspo.id]), /before moving this to Inspo/);
});

test('post edits: author only, same rules as a new post, marked as edited', async () => {
  const author = await createUser(db, { email: 'editor@test.dev' });
  const other = await createUser(db, { email: 'not-editor@test.dev' });
  const [{ id }] = ok(await as(db, author, `select public.create_post('First draft of a thought', '{}') as id`));
  const upd = (uid, body, tags = []) => as(db, uid, `select public.update_post($1, $2, $3::text[])`, [id, body, tags]);
  fails(await upd(other, 'hijacked'), /Post not found/, 'edit someone else\'s post');
  fails(await upd(null, 'anon'), /permission denied|Sign in|Not signed in/i, 'anon edits');
  fails(await upd(author, '   '), /Write something/);
  fails(await upd(author, 'x'.repeat(1501)), /1,500/);
  fails(await upd(author, 'ok', ['bad tag!']), /Tags are/);
  ok(await upd(author, 'Second, better draft', ['#Ideas', 'ideas', 'design']));
  const [card] = ok(await as(db, null, `select body, tags, edited_at from public.post_cards where id = $1`, [id]));
  assert.equal(card.body, 'Second, better draft');
  assert.deepEqual(card.tags, ['ideas', 'design']);
  assert.ok(card.edited_at, 'marked as edited');
  ok(await as(db, author, `select public.delete_post($1)`, [id]));
  fails(await upd(author, 'after delete'), /Post not found/, 'edit a deleted post');
});

test('friends, activity status, suspensions and admin tools', async () => {
  const ann = await createUser(db, { email: 'ann@test.dev' });
  const ben = await createUser(db, { email: 'ben@test.dev' });
  const cal = await createUser(db, { email: 'cal@test.dev' });
  const chief = await createUser(db, { email: 'chief@test.dev' });
  await sql(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [chief]);
  const follow = (a, b) => as(db, a, `insert into public.follows (followee_id) values ($1)`, [b]);
  ok(await follow(ann, ben)); ok(await follow(ben, ann)); // friends
  ok(await follow(cal, ann));                             // one-way: not a friend

  // Friends lists: private by default, visible to the owner, public when they choose.
  const friendsOf = (viewer, of) => as(db, viewer, `select id from public.friends_of($1)`, [of]).then((r) => ok(r).map((x) => x.id));
  assert.deepEqual(await friendsOf(ann, ann), [ben], 'mutual follows only');
  assert.deepEqual(await friendsOf(cal, ann), [], 'private list');
  assert.deepEqual(await friendsOf(null, ann), [], 'private list, signed out');
  ok(await as(db, ann, `update public.profiles set friends_public = true where id = $1`, [ann]));
  assert.deepEqual(await friendsOf(null, ann), [ben], 'public list');
  none(await as(db, cal, `update public.profiles set friends_public = true where id = $1 returning id`, [ann]), 'toggle someone else\'s list');

  // Status: only friends see it, timestamps never leak, "appear offline" hides you.
  const statusOf = (viewer, of) => as(db, viewer, `select public.user_status($1) as s`, [of]).then((r) => ok(r)[0].s);
  assert.equal(await statusOf(ben, ann), 'offline', 'never seen');
  ok(await as(db, ann, `select public.touch_presence(true)`));
  assert.equal(await statusOf(ben, ann), 'online');
  assert.equal(await statusOf(cal, ann), null, 'non-friend sees no status');
  assert.equal(await statusOf(null, ann), null, 'signed out sees no status');
  fails(await as(db, cal, `select * from public.user_presence`).then((r) => (r.rows?.length ? { error: { message: 'leak' } } : { error: { message: 'none' } })), /none/, 'presence rows of others');
  fails(await as(db, ben, `select public.presence_status($1)`, [ann]), /permission denied/, 'internal status function');
  ok(await as(db, ann, `select public.set_my_status('idle')`));
  assert.equal(await statusOf(ben, ann), 'idle');
  ok(await as(db, ann, `select public.set_my_status('invisible')`));
  assert.equal(await statusOf(ben, ann), 'offline', 'appear offline');
  fails(await as(db, ann, `select public.set_my_status('dnd-hacked')`), /Choose Online/);
  const friends = ok(await as(db, ben, `select id, status from public.my_friends()`));
  assert.deepEqual(friends.map((f) => [f.id, f.status]), [[ann, 'offline']]);
  await sql(`update public.user_presence set last_seen_at = now() - interval '10 minutes', status_mode = 'online' where user_id = $1`, [ann]);
  assert.equal(await statusOf(ben, ann), 'offline', 'gone quiet');

  // Admin tools: admins only.
  fails(await as(db, u.mod, `select public.admin_users(null, 10)`).then((r) => (r.error ? r : (r.rows.length ? { error: { message: 'leak' } } : { error: { message: 'none' } }))), /none/, 'moderator lists users');
  const users = ok(await as(db, chief, `select id, email from public.admin_users('ann@', 10)`));
  assert.deepEqual(users.map((x) => x.email), ['ann@test.dev']);
  ok(await as(db, u.mod, `select public.admin_overview() as o`));
  fails(await as(db, ann, `select public.admin_overview()`), /Moderators only/);
  fails(await as(db, u.mod, `select public.admin_set_moderator($1, true)`, [cal]), /Admins only/);
  ok(await as(db, chief, `select public.admin_set_moderator($1, true)`, [cal]));
  ok(await as(db, chief, `select public.admin_set_trust($1, true)`, [cal]));
  assert.equal((await sql(`select trust_level from public.profiles where id = $1`, [cal]))[0].trust_level, 1);

  // Suspension: reason required, never an admin, removes staff roles, blocks RPCs and direct writes.
  fails(await as(db, chief, `select public.admin_suspend($1, true, '')`, [cal]), /reason/);
  fails(await as(db, chief, `select public.admin_suspend($1, true, 'nope')`, [chief]), /yourself/);
  fails(await as(db, u.mod, `select public.admin_suspend($1, true, 'spam')`, [cal]), /Admins only/);
  ok(await as(db, chief, `select public.admin_suspend($1, true, 'Spam uploads')`, [cal]));
  assert.equal(ok(await as(db, cal, `select public.my_staff_role() as r`))[0].r, null, 'roles removed');
  fails(await as(db, cal, `select public.create_post('still here?', '{}')`), /suspended/);
  fails(await as(db, cal, `insert into public.follows (followee_id) values ($1)`, [ben]), /row-level security/, 'direct write while suspended');
  fails(await as(db, cal, `update public.profiles set bio = 'x' where id = $1`, [cal]).then((r) => (r.error ? r : (r.affected ? { error: { message: 'edited' } } : { error: { message: 'blocked' } }))), /blocked/, 'profile edit while suspended');
  ok(await as(db, chief, `select public.admin_suspend($1, false)`, [cal]));
  ok(await as(db, cal, `insert into public.follows (followee_id) values ($1)`, [ben]));
  const log = await sql(`select action from public.moderation_log where target_id = $1 order by id`, [cal]);
  assert.deepEqual(log.map((l) => l.action), ['grant_moderator', 'trust_creator', 'suspend_user', 'unsuspend_user']);
});

test('post images: server-picked paths, own images only, up to 4, image-only posts allowed', async () => {
  const poster = await createUser(db, { email: 'pics@test.dev' });
  const thief = await createUser(db, { email: 'pics-thief@test.dev' });
  const prep = (uid, type = 'image/webp', size = 200000) =>
    as(db, uid, `select public.prepare_post_image($1, $2) as path`, [type, size]);

  fails(await prep(poster, 'image/svg+xml'), /PNG, JPG/, 'SVG can carry script');
  fails(await prep(poster, 'text/html'), /PNG, JPG/);
  fails(await prep(poster, 'image/png', 6 * 1024 * 1024), /5 MB/);
  fails(await prep(u.unverified), /Verify your email/);
  const paths = [];
  for (let i = 0; i < 5; i++) paths.push(ok(await prep(poster))[0].path);
  assert.match(paths[0], new RegExp(`^${poster}/posts/[0-9a-f-]{36}\\.webp$`));
  fails(await as(db, poster, `insert into public.post_images (owner_id, path) values ($1, 'x/posts/y.png')`, [poster]), /permission denied/, 'direct insert');

  const create = (uid, body, imgs) => as(db, uid, `select public.create_post($1, '{}', $2::jsonb) as id`, [body, JSON.stringify(imgs)]);
  fails(await create(poster, 'too many', paths.slice(0, 5).map((path) => ({ path }))), /up to 4 images/);
  fails(await create(thief, 'stolen', [{ path: paths[0] }]), /isn't yours/, 'someone else\'s image');
  fails(await create(poster, 'made up', [{ path: `${poster}/posts/00000000-0000-0000-0000-000000000000.webp` }]), /isn't yours/, 'a path that was never issued');
  fails(await create(poster, '   ', []), /Write something or add an image/);

  const [{ id }] = ok(await create(poster, '', [{ path: paths[0], alt: 'A dashboard', width: 1600, height: 1000 }, { path: paths[1], width: 'x' }]));
  const [card] = ok(await as(db, null, `select body, images from public.post_cards where id = $1`, [id]));
  assert.equal(card.body, '', 'image-only post');
  assert.deepEqual(card.images.map((i) => [i.path, i.alt, i.width]), [[paths[0], 'A dashboard', 1600], [paths[1], null, null]]);
  fails(await create(poster, 'reuse', [{ path: paths[0] }]), /isn't yours|already used/, 'image used twice');

  // Pending images are private to their owner; attached ones follow the post.
  none(await as(db, thief, `select 1 from public.post_images where path = $1`, [paths[2]]), 'someone else\'s pending image');
  assert.equal(ok(await as(db, null, `select 1 from public.post_images where post_id = $1`, [id])).length, 2);
  ok(await as(db, poster, `select public.delete_post($1)`, [id]));
  none(await as(db, null, `select 1 from public.post_images where post_id = $1`, [id]), 'images of a removed post');
  fails(await as(db, poster, `select public.update_post($1, '', '{}')`, [id]), /not found/i);
});

test('direct messages: friends chat, others request, members only, blocks, limits, private photos', async () => {
  const amy = await createUser(db, { email: 'amy@test.dev' });
  const bo = await createUser(db, { email: 'bo@test.dev' });
  const cy = await createUser(db, { email: 'cy@test.dev' });   // a stranger to amy
  const eve = await createUser(db, { email: 'eve@test.dev' }); // an outsider trying to read
  ok(await as(db, amy, `insert into public.follows (followee_id) values ($1)`, [bo]));
  ok(await as(db, bo, `insert into public.follows (followee_id) values ($1)`, [amy]));
  const start = (uid, other) => as(db, uid, `select public.start_conversation($1) as id`, [other]).then((r) => (r.error ? r : { rows: r.rows, id: r.rows[0].id }));
  const send = (uid, c, body, imgs = []) => as(db, uid, `select public.send_message($1, $2, $3::jsonb) as id`, [c, body, JSON.stringify(imgs)]);
  const convos = async (uid) => ok(await as(db, uid, `select id, status, incoming_request, unread from public.my_conversations()`));

  fails(await start(amy, amy), /yourself/);
  fails(await as(db, amy, `insert into public.messages (conversation_id, sender_id, body) values (gen_random_uuid(), $1, 'x')`, [amy]), /permission denied/, 'direct insert');

  // Friends: an ordinary chat straight away.
  const { id: ab } = await start(amy, bo);
  assert.equal((await start(bo, amy)).id, ab, 'one conversation per pair');
  ok(await send(amy, ab, 'hey bo'));
  ok(await send(bo, ab, 'hey amy'));
  assert.deepEqual((await convos(amy)).map((c) => [c.status, c.unread]), [['active', 1]]);
  ok(await as(db, amy, `select public.mark_conversation_read($1)`, [ab]));
  assert.equal((await convos(amy))[0].unread, 0);
  assert.equal(ok(await as(db, bo, `select public.my_unread_messages() as n`))[0].n, 0, 'own messages never count as unread');

  // Outsiders see nothing, can't send, can't report.
  none(await as(db, eve, `select 1 from public.messages where conversation_id = $1`, [ab]), 'outsider reads messages');
  none(await as(db, eve, `select 1 from public.conversations where id = $1`, [ab]), 'outsider reads the conversation');
  fails(await send(eve, ab, 'let me in'), /Conversation not found/);
  const [m1] = await sql(`select id from public.messages where conversation_id = $1 order by created_at limit 1`, [ab]);
  fails(await as(db, eve, `insert into public.reports (target_type, target_id, reason) values ('message', $1, 'spam')`, [m1.id]), /Message not found/);

  // Strangers: a request, at most 3 messages, then the recipient decides.
  const { id: ca } = await start(cy, amy);
  for (const t of ['hi', 'are you there', 'third']) ok(await send(cy, ca, t));
  fails(await send(cy, ca, 'fourth'), /up to 3 messages/);
  const inbox = await convos(amy);
  assert.deepEqual(inbox.filter((c) => c.id === ca).map((c) => [c.status, c.incoming_request]), [['request', true]]);
  assert.equal(ok(await as(db, amy, `select public.my_unread_messages() as n`))[0].n, 0, 'requests do not ring the header badge');
  fails(await as(db, cy, `select public.respond_to_request($1, true)`, [ca]), /Request not found/, 'the sender accepts their own request');
  ok(await as(db, amy, `select public.respond_to_request($1, false)`, [ca]));
  fails(await send(cy, ca, 'please'), /isn't accepting/);
  assert.ok(!(await convos(amy)).some((c) => c.id === ca), 'declined request hidden from the decliner');
  ok(await send(amy, ca, 'changed my mind'));   // replying reopens it
  ok(await send(cy, ca, 'yay'));

  // Blocking stops both directions; unblocking restores.
  ok(await as(db, amy, `select public.set_block($1, true)`, [cy]));
  fails(await send(cy, ca, 'blocked?'), /can't message/);
  fails(await send(amy, ca, 'me neither?'), /can't message/);
  none(await as(db, cy, `select 1 from public.user_blocks`), 'blocked person sees the block list');
  ok(await as(db, amy, `select public.set_block($1, false)`, [cy]));

  // Unsend: sender only; the text is gone for both.
  const [mine] = ok(await send(amy, ab, 'oops'));
  fails(await as(db, bo, `select public.delete_message($1)`, [mine.id]), /not found/i, 'unsend someone else\'s message');
  ok(await as(db, amy, `select public.delete_message($1)`, [mine.id]));
  assert.equal((await sql(`select body from public.messages where id = $1`, [mine.id]))[0].body, '');

  // Photos: server-issued paths, own and unsent only, visible to members only.
  const [{ p }] = ok(await as(db, amy, `select public.prepare_message_image('webp', 800, 600) as p`));
  assert.match(p, new RegExp(`^dm/${amy}/[0-9a-f-]{36}\\.webp$`));
  fails(await as(db, amy, `select public.prepare_message_image('svg', 10, 10)`), /PNG, JPG/);
  fails(await send(bo, ab, '', [{ path: p }]), /isn't yours/, 'send someone else\'s photo');
  ok(await send(amy, ab, '', [{ path: p }]));
  fails(await send(amy, ab, 'again', [{ path: p }]), /already sent/);
  assert.deepEqual(ok(await as(db, bo, `select * from public.visible_message_images(array[$1])`, [p])).length, 1);
  none(await as(db, eve, `select * from public.visible_message_images(array[$1])`, [p]), 'outsider gets a photo link');
  fails(await as(db, eve, `select * from public.message_images`), /permission denied/);

  // Moderators read a message only after a member reports it.
  none(await as(db, u.mod, `select id from public.reported_messages(array[$1]::uuid[])`, [m1.id]), 'mod reads an unreported message');
  none(await as(db, u.mod, `select 1 from public.messages where id = $1`, [m1.id]), 'mod reads messages directly');
  ok(await as(db, bo, `insert into public.reports (target_type, target_id, reason) values ('message', $1, 'spam')`, [m1.id]));
  assert.equal(ok(await as(db, u.mod, `select body from public.reported_messages(array[$1]::uuid[])`, [m1.id]))[0].body, 'hey bo');
});

test('channels: create, join, post, roles, kick/ban, staff powers and their limits', async () => {
  const own = await createUser(db, { email: 'chan-owner@test.dev' });
  const mod = await createUser(db, { email: 'chan-mod@test.dev' });
  const mem = await createUser(db, { email: 'chan-member@test.dev' });
  const out = await createUser(db, { email: 'chan-outsider@test.dev' });
  const create = (uid, name, slug) => as(db, uid, `select public.create_channel($1, $2, 'A test channel') as id`, [name, slug]);

  fails(await create(u.unverified, 'Nope', 'nope'), /Verify your email/);
  fails(await create(own, 'Okay name', 'Bad Slug!'), /lowercase letters/);
  fails(await create(own, 'x', 'short-name'), /3 to 40/);
  const [{ id: ch }] = ok(await create(own, 'React Builders', 'react-builders'));
  fails(await create(mod, 'Dup', 'react-builders'), /taken/);
  fails(await as(db, own, `insert into public.channels (slug, name, owner_id) values ('x-x-x', 'Direct', $1)`, [own]), /permission denied/, 'direct insert');
  assert.equal((await sql(`select role from public.channel_members where channel_id = $1 and user_id = $2`, [ch, own]))[0].role, 'owner');

  // Posting: members only.
  const post = (uid, body) => as(db, uid, `select public.create_channel_post($1, $2) as id`, [ch, body]);
  fails(await post(out, 'not a member'), /Join the channel/);
  for (const uid of [mod, mem, out]) ok(await as(db, uid, `select public.join_channel($1)`, [ch]));
  assert.equal((await sql(`select member_count from public.channels where id = $1`, [ch]))[0].member_count, 4);
  const [{ id: p1 }] = ok(await post(mem, 'Hello channel'));
  const [card] = ok(await as(db, null, `select channel_slug, channel_name from public.post_cards where id = $1`, [p1]));
  assert.deepEqual([card.channel_slug, card.channel_name], ['react-builders', 'React Builders']);

  // Roles: owner only.
  fails(await as(db, mem, `select public.set_channel_role($1, $2, 'mod')`, [ch, mem]), /Only the owner/);
  ok(await as(db, own, `select public.set_channel_role($1, $2, 'mod')`, [ch, mod]));
  fails(await as(db, mod, `select public.set_channel_role($1, $2, 'mod')`, [ch, mem]), /Only the owner/, 'a mod promotes someone');
  fails(await as(db, own, `select public.set_channel_role($1, $2, 'owner')`, [ch, mem]), /moderator or member/);

  // Staff powers: remove posts (logged per channel), kick, ban with a reason.
  fails(await as(db, out, `select public.delete_post($1, 'spam')`, [p1]), /Not allowed/, 'member removes another member\'s post');
  fails(await as(db, mod, `select public.delete_post($1)`, [p1]), /reason is required/);
  ok(await as(db, mod, `select public.delete_post($1, 'off topic')`, [p1]));
  assert.deepEqual((await sql(`select action from public.channel_mod_log where channel_id = $1 and target_id = $2`, [ch, p1])).map((l) => l.action), ['remove_post']);
  fails(await as(db, mod, `select public.moderate_channel_member($1, $2, 'kick')`, [ch, own]), /owner or another moderator/, 'mod kicks the owner');
  fails(await as(db, mem, `select public.moderate_channel_member($1, $2, 'kick')`, [ch, out]), /Only channel moderators/);
  fails(await as(db, mod, `select public.moderate_channel_member($1, $2, 'ban', '')`, [ch, out]), /reason is required/);
  ok(await as(db, mod, `select public.moderate_channel_member($1, $2, 'ban', 'spamming links')`, [ch, out]));
  fails(await as(db, out, `select public.join_channel($1)`, [ch]), /banned/);
  fails(await post(out, 'still here?'), /banned/);
  const [{ id: p2 }] = ok(await post(mem, 'Second post'));
  fails(await as(db, out, `select public.create_post_comment($1, 'sneaky')`, [p2]), /banned/, 'banned person comments');
  none(await as(db, mem, `select 1 from public.channel_bans`), 'ordinary member reads the ban list');
  assert.equal(ok(await as(db, out, `select reason from public.channel_bans`))[0].reason, 'spamming links', 'banned person sees why');
  none(await as(db, mem, `select 1 from public.channel_mod_log`), 'member reads the mod log');
  ok(await as(db, mod, `select public.moderate_channel_member($1, $2, 'unban')`, [ch, out]));
  ok(await as(db, out, `select public.join_channel($1)`, [ch]));

  // The owner can act on mods; owners can't leave; only the owner edits or deletes.
  ok(await as(db, own, `select public.moderate_channel_member($1, $2, 'kick')`, [ch, mod]));
  fails(await as(db, own, `select public.leave_channel($1)`, [ch]), /Owners can't leave/);
  ok(await as(db, mem, `select public.leave_channel($1)`, [ch]));
  fails(await as(db, mem, `select public.update_channel($1, 'Hijacked', '', '')`, [ch]), /Only the owner/);
  fails(await as(db, mem, `select public.delete_channel($1)`, [ch]), /Only the owner/);
  ok(await as(db, own, `select public.update_channel($1, 'React Builders Club', 'Ship React things', 'Be kind')`, [ch]));
  ok(await as(db, own, `select public.delete_channel($1)`, [ch]));
  none(await as(db, null, `select 1 from public.post_cards where id = $1`, [p2]), 'posts of a deleted channel are hidden');
});

test('calls: friends only, one at a time, only the callee answers, summaries land in the chat', async () => {
  const ana = await createUser(db, { email: 'call-ana@test.dev' });
  const ben = await createUser(db, { email: 'call-ben@test.dev' });
  const cat = await createUser(db, { email: 'call-cat@test.dev' });   // not ana's friend
  const dee = await createUser(db, { email: 'call-dee@test.dev' });   // ben's other friend
  const befriend = async (a, b) => { ok(await as(db, a, `insert into public.follows (followee_id) values ($1)`, [b])); ok(await as(db, b, `insert into public.follows (followee_id) values ($1)`, [a])); };
  await befriend(ana, ben);
  await befriend(dee, ben);
  const convo = async (a, b) => ok(await as(db, a, `select public.start_conversation($1) as id`, [b]))[0].id;
  const ab = await convo(ana, ben);
  const ac = await convo(ana, cat);
  const db_ = await convo(dee, ben);
  const start = (uid, c, video = false) => as(db, uid, `select public.start_call($1, $2) as id`, [c, video]);

  fails(await start(ana, ac), /friends only/, 'calling a non-friend');
  fails(await start(cat, ab), /Conversation not found/, 'calling into someone else\'s chat');
  fails(await as(db, ana, `insert into public.calls (conversation_id, caller_id, callee_id) values ($1, $2, $3)`, [ab, ana, ben]), /permission denied/, 'direct insert');

  const [{ id: c1 }] = ok(await start(ana, ab, true));
  fails(await start(dee, db_), /another call/, 'ringing someone already being rung');
  fails(await start(ana, ab), /already in a call/);
  const answer = async (uid, c) => ok(await as(db, uid, `select public.answer_call($1) as r`, [c]))[0].r;
  assert.equal(await answer(ana, c1), 'ended', 'caller answers their own call');
  assert.equal(await answer(cat, c1), 'ended', 'outsider answers');
  none(await as(db, cat, `select 1 from public.calls where id = $1`, [c1]), 'outsider sees the call');
  assert.equal(ok(await as(db, ben, `select id from public.my_incoming_call()`))[0].id, c1, 'callee sees it ringing');

  assert.equal(await answer(ben, c1), 'answered');
  await sql(`update public.calls set answered_at = now() - interval '125 seconds' where id = $1`, [c1]);
  ok(await as(db, ben, `select public.end_call($1)`, [c1]));
  ok(await as(db, ana, `select public.end_call($1)`, [c1]), 'hanging up twice is harmless');
  const [log1] = await sql(`select body, kind, sender_id from public.messages where conversation_id = $1 and kind = 'call' order by created_at desc limit 1`, [ab]);
  assert.deepEqual([log1.body, log1.kind, log1.sender_id], ['Video call · 2 min', 'call', ana]);

  // Declined, cancelled and unanswered calls.
  const [{ id: c2 }] = ok(await start(ana, ab));
  fails(await as(db, ana, `select public.decline_call($1)`, [c2]), /has ended/, 'caller declines');
  ok(await as(db, ben, `select public.decline_call($1)`, [c2]));
  const [{ id: c3 }] = ok(await start(ana, ab));
  ok(await as(db, ana, `select public.end_call($1)`, [c3]));
  const [{ id: c4 }] = ok(await start(ana, ab));
  await sql(`update public.calls set created_at = now() - interval '2 minutes' where id = $1`, [c4]);
  assert.equal(await answer(ben, c4), 'ended', 'answering after 45 s');
  const logs = (await sql(`select body from public.messages where conversation_id = $1 and kind = 'call' order by created_at`, [ab])).map((m) => m.body);
  assert.deepEqual(logs, ['Video call · 2 min', 'Call declined', 'Missed call', 'Missed call'], 'a rung-out call is logged too');
  assert.equal((await sql(`select status from public.calls where id = $1`, [c4]))[0].status, 'missed');

  // A block stops calls even between friends.
  ok(await as(db, ben, `select public.set_block($1, true)`, [ana]));
  fails(await start(ana, ab), /can't call/);
});

test('group chats: friends only, admins manage, members only, notices, unread', async () => {
  const [gia, hal, ivy, jon, kim, out] = await Promise.all(['gia', 'hal', 'ivy', 'jon', 'kim', 'out'].map((n) => createUser(db, { email: `grp-${n}@test.dev` })));
  const befriend = async (a, b) => { ok(await as(db, a, `insert into public.follows (followee_id) values ($1)`, [b])); ok(await as(db, b, `insert into public.follows (followee_id) values ($1)`, [a])); };
  for (const f of [hal, ivy, jon, kim]) await befriend(gia, f);
  const create = (uid, title, members) => as(db, uid, `select public.create_group($1, $2::uuid[]) as id`, [title, members]);

  fails(await create(gia, 'Crew', [hal]), /at least 2/, 'group of two');
  fails(await create(gia, '   ', [hal, ivy]), /name/, 'blank name');
  fails(await create(gia, 'Crew', [hal, out]), /only add your friends/, 'adding a stranger');
  fails(await as(db, gia, `insert into public.conversations (kind, title) values ('group', 'x')`), /permission denied/, 'direct insert');
  fails(await as(db, gia, `insert into public.group_members (conversation_id, user_id) values (gen_random_uuid(), $1)`, [gia]), /permission denied/);

  const [{ id: g }] = ok(await create(gia, 'Crew', [hal, ivy, hal]));
  const members = async (uid) => ok(await as(db, uid, `select user_id, role from public.group_members_of($1)`, [g]));
  assert.equal((await members(hal)).length, 3, 'duplicates ignored');
  none(await as(db, out, `select 1 from public.group_members_of($1)`, [g]), 'outsider lists members');
  none(await as(db, out, `select 1 from public.conversations where id = $1`, [g]), 'outsider sees the group');
  none(await as(db, out, `select 1 from public.messages where conversation_id = $1`, [g]), 'outsider reads the group');
  fails(await as(db, out, `select public.send_message($1, 'hi')`, [g]), /not found/, 'outsider posts');

  ok(await as(db, hal, `select public.send_message($1, 'hello crew')`, [g]));
  const inbox = async (uid) => ok(await as(db, uid, `select id, kind, other_display_name, unread, member_count, my_role, last_sender_name from public.my_conversations()`)).find((c) => c.id === g);
  const halName = (await sql(`select display_name from public.profiles where id = $1`, [hal]))[0].display_name;
  const ivyRow = await inbox(ivy);
  assert.deepEqual([ivyRow.kind, ivyRow.other_display_name, ivyRow.member_count, ivyRow.my_role, ivyRow.last_sender_name], ['group', 'Crew', 3, 'member', halName]);
  assert.equal(ivyRow.unread, 2, 'the "started the group" notice and the first message');
  ok(await as(db, ivy, `select public.mark_conversation_read($1)`, [g]));
  assert.equal((await inbox(ivy)).unread, 0);
  assert.equal((await inbox(hal)).unread, 0, 'sending marks the chat read');

  // Only admins manage, and only their own friends can be added.
  fails(await as(db, hal, `select public.add_group_members($1, $2::uuid[])`, [g, [jon]]), /Only group admins/);
  fails(await as(db, hal, `select public.rename_group($1, 'Mine')`, [g]), /Only group admins/);
  fails(await as(db, hal, `select public.remove_group_member($1, $2)`, [g, ivy]), /Only group admins/);
  fails(await as(db, gia, `select public.add_group_members($1, $2::uuid[])`, [g, [out]]), /only add your friends/);
  ok(await as(db, gia, `select public.add_group_members($1, $2::uuid[])`, [g, [jon]]));
  ok(await as(db, gia, `select public.set_group_admin($1, $2, true)`, [g, hal]));
  fails(await as(db, hal, `select public.set_group_admin($1, $2, false)`, [g, gia]), /stays an admin/, 'demoting the creator');
  fails(await as(db, hal, `select public.remove_group_member($1, $2)`, [g, gia]), /can't be removed/, 'removing the creator');
  ok(await as(db, gia, `select public.rename_group($1, 'Night crew')`, [g]));
  ok(await as(db, hal, `select public.remove_group_member($1, $2)`, [g, jon]));
  none(await as(db, jon, `select 1 from public.messages where conversation_id = $1`, [g]), 'a removed member loses access');
  fails(await as(db, jon, `select public.send_message($1, 'still here?')`, [g]), /not found/);

  // Size limit: 10 people.
  const extra = await Promise.all([...Array(7)].map((_, i) => createUser(db, { email: `grp-x${i}@test.dev` })));
  for (const x of extra) await befriend(gia, x);
  fails(await as(db, gia, `select public.add_group_members($1, $2::uuid[])`, [g, [...extra, kim]]), /up to 10/);

  // Group photo: admins only, only a file in your own folder that really exists.
  const photo = (uid, path) => as(db, uid, `select public.set_group_photo($1, $2)`, [g, path]);
  const own = `${gia}/group-abc123def456.webp`;
  fails(await photo(ivy, `${ivy}/group-abc123def456.webp`), /Only group admins/, 'member sets the photo');
  fails(await photo(gia, `${hal}/group-abc123def456.webp`), /Invalid image/, 'someone else\'s file');
  fails(await photo(gia, `${gia}/avatar-abc123def456.webp`), /Invalid image/, 'not a group photo path');
  fails(await photo(gia, own), /Upload the photo first/, 'a file that was never uploaded');
  await sql(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [own, gia]);
  ok(await photo(gia, own));
  assert.equal((await inbox(ivy)).other_avatar_path ?? ok(await as(db, ivy, `select other_avatar_path from public.my_conversations() where id = $1`, [g]))[0].other_avatar_path, own, 'members see the photo');
  fails(await as(db, gia, `update public.conversations set photo_path = null where id = $1`, [g]), /permission denied/, 'direct update');
  ok(await photo(gia, null));

  // Notices can't be unsent.
  const [notice] = await sql(`select id from public.messages where conversation_id = $1 and kind = 'system' limit 1`, [g]);
  fails(await as(db, gia, `select public.delete_message($1)`, [notice.id]), /not found/, 'unsending a notice');

  // The last admin leaving hands the group on.
  ok(await as(db, gia, `select public.leave_group($1)`, [g]));
  ok(await as(db, hal, `select public.leave_group($1)`, [g]));
  assert.deepEqual((await members(ivy)).map((m) => m.role), ['admin'], 'the remaining member takes over as admin');
  const notices = (await sql(`select body from public.messages where conversation_id = $1 and kind = 'system' order by created_at`, [g])).map((m) => m.body);
  assert.ok(notices.some((n) => n.endsWith('named the group "Night crew"')) && notices.some((n) => n.endsWith(' left the group')), notices.join(' | '));
});

test('group calls: members only, ring, join up to 6, leave ends it, summaries land in the chat', async () => {
  const people = await Promise.all([...Array(8)].map((_, i) => createUser(db, { email: `gcall-${i}@test.dev` })));
  const [lead, ...rest] = people;
  const out = await createUser(db, { email: 'gcall-out@test.dev' });
  for (const p of rest) { ok(await as(db, lead, `insert into public.follows (followee_id) values ($1)`, [p])); ok(await as(db, p, `insert into public.follows (followee_id) values ($1)`, [lead])); }
  const [{ id: g }] = ok(await as(db, lead, `select public.create_group('Call crew', $1::uuid[]) as id`, [rest]));
  const start = (uid, video = false) => as(db, uid, `select public.start_group_call($1, $2) as id`, [g, video]);
  const join = async (uid, c) => ok(await as(db, uid, `select public.join_group_call($1) as r`, [c]))[0].r;
  const onChannel = async (uid, c) => ok(await as(db, uid, `select public.is_call_member($1) as m`, [c]))[0].m;

  fails(await start(out), /Group not found/, 'outsider starts a call');
  fails(await as(db, lead, `insert into public.calls (conversation_id, caller_id, video, is_group) values ($1, $2, false, true)`, [g, lead]), /permission denied/);
  const [{ id: c }] = ok(await start(lead, true));
  assert.equal(ok(await as(db, rest[0], `select id, is_group, group_title from public.my_incoming_call()`))[0].group_title, 'Call crew', 'members ring');
  none(await as(db, out, `select 1 from public.calls where id = $1`, [c]), 'outsider sees the call');
  none(await as(db, out, `select 1 from public.call_participants where call_id = $1`, [c]));
  fails(await as(db, out, `select public.join_group_call($1)`, [c]), /not found/, 'outsider joins');
  assert.equal(await onChannel(out, c), false, 'outsider on the signalling channel');
  assert.equal(await onChannel(rest[0], c), false, 'only people who joined use the channel');

  // A second Start joins the call that's already going.
  const [{ id: again }] = ok(await start(rest[0]));
  assert.equal(again, c, 'one call per group');
  assert.equal(await onChannel(rest[0], c), true);
  assert.equal((await sql(`select status from public.calls where id = $1`, [c]))[0].status, 'active');
  for (const p of rest.slice(1, 5)) assert.equal(await join(p, c), 'joined');
  assert.equal(await join(rest[5], c), 'full', 'a 7th person can\'t join');
  ok(await as(db, rest[6], `select public.decline_group_call($1)`, [c]));
  none(await as(db, rest[6], `select id from public.my_incoming_call()`), 'declining stops the ringing');
  const dm = ok(await as(db, rest[0], `select public.start_conversation($1) as id`, [lead]))[0].id;
  fails(await as(db, rest[0], `select public.start_call($1)`, [dm]), /already in a call/, '1-to-1 while in a group call');

  // A browser that stops checking in is dropped.
  await sql(`update public.call_participants set last_seen_at = now() - interval '2 minutes' where call_id = $1 and user_id = $2`, [c, rest[4]]);
  const pulse = ok(await as(db, lead, `select public.group_call_pulse($1) as p`, [c]))[0].p;
  assert.equal(pulse.participants.length, 5, 'the silent one is out');
  assert.equal(ok(await as(db, out, `select public.group_call_pulse($1) as p`, [c]))[0].p, null, 'outsider pulse');

  await sql(`update public.calls set answered_at = now() - interval '3 minutes' where id = $1`, [c]);
  for (const p of [lead, ...rest.slice(0, 4)]) ok(await as(db, p, `select public.end_call($1)`, [c]));
  assert.equal((await sql(`select status from public.calls where id = $1`, [c]))[0].status, 'ended', 'the last one out ends it');
  const lastLog = async () => (await sql(`select body from public.messages where conversation_id = $1 and kind = 'call' order by created_at desc limit 1`, [g]))[0].body;
  assert.equal(await lastLog(), 'Group video call · 3 min');

  // Nobody joins: missed.
  const [{ id: c2 }] = ok(await start(lead));
  await sql(`update public.calls set created_at = now() - interval '1 minute' where id = $1`, [c2]);
  assert.equal(await join(rest[0], c2), 'ended');
  assert.equal(await lastLog(), 'Missed group call');
  assert.equal((await sql(`select count(*)::int as n from public.call_participants where call_id = $1 and state in ('joined', 'ringing')`, [c2]))[0].n, 0);

  // Leaving the group takes you out of its call.
  const [{ id: c3 }] = ok(await start(lead));
  assert.equal(await join(rest[0], c3), 'joined');
  ok(await as(db, rest[0], `select public.leave_group($1)`, [g]));
  assert.equal(await onChannel(rest[0], c3), false);
});

test('reports are private to the reporter and moderators', async () => {
  ok(await as(db, u.bob, `insert into public.reports (target_type, target_id, reason) values ('template', $1, 'broken')`, [s.tpl]));
  none(await as(db, u.alice, `select id from public.reports`));
  assert.equal(ok(await as(db, u.mod, `select id from public.reports where target_id = $1`, [s.tpl])).length, 1);
  fails(await as(db, u.bob, `update public.reports set status = 'resolved'`), /permission denied/);
});

// ─────────────────────────────────────────────── versions, yanks, awards
test('yanking keeps history and blocks downloads of the pulled version', async () => {
  fails(await as(db, u.alice, `select public.yank_version($1, 'broken')`, [s.ver]), /replacement/);
  fails(await as(db, u.alice, `select public.create_version($1, '0.9.0')`, [s.tpl]), /greater than/);
  const [v2] = ok(await as(db, u.alice, `select public.create_version($1, '1.1.0') as id`, [s.tpl]));
  const [lic] = await sql(`select license_code from public.template_versions where id = $1`, [v2.id]);
  assert.equal(lic.license_code, 'MIT', 'license carried forward');
  const [{ path: v2path }] = ok(await as(db, u.alice, `select public.prepare_file_upload($1, 'nocturne.fig', 2000000) as path`, [v2.id]));
  const [f2] = ok(await as(db, u.alice, `select public.register_file($1, $2, 'nocturne.fig', 2000000) as id`, [v2.id, v2path]));
  ok(await as(db, 'service', `select * from public.claim_scan_jobs(1)`));
  ok(await as(db, 'service', `select public.complete_scan($1, 'clean', $2, $3, null, '{}'::jsonb, null)`,
              [f2.id, `${u.alice}/${s.tpl}/${v2.id}/nocturne.fig`, 'b'.repeat(64)]));
  ok(await as(db, u.alice, `select public.publish_version($1, true)`, [v2.id]));
  ok(await as(db, u.alice, `select public.yank_version($1, 'Broken font import')`, [s.ver]));
  const [t] = await sql(`select status, current_version_id from public.templates where id = $1`, [s.tpl]);
  assert.equal(t.current_version_id, v2.id);
  assert.equal(t.status, 'published', 'already-approved template stays published');
  fails(await as(db, u.bob, `select * from public.begin_download($1, true)`, [s.file]), /pulled by the creator/);
  const hist = ok(await as(db, null, `select version, status from public.template_versions where template_id = $1 order by version`, [s.tpl]));
  assert.deepEqual(hist.map((h) => h.status), ['yanked', 'published']);
});

test('awards are immutable and a template wins each award once', async () => {
  await db.query(`insert into public.awards (template_id, period, period_start, score_snapshot, vote_count_snapshot)
                  values ($1, 'day', current_date, 8.7, 2)`, [s.tpl]);
  await assert.rejects(db.query(`insert into public.awards (template_id, period, period_start, score_snapshot, vote_count_snapshot)
                                 values ($1, 'day', current_date + 1, 9, 3)`, [s.tpl]), /duplicate key/);
  await assert.rejects(db.query(`update public.awards set score_snapshot = 10`), /immutable/);
  await db.query(`update public.awards set blurb = 'Voters loved the chart tokens.'`);
  fails(await as(db, u.alice, `insert into public.awards (template_id, period, period_start, score_snapshot, vote_count_snapshot)
                               values ($1, 'week', current_date, 10, 1)`, [s.tpl]), /permission denied/);
});

test('removed templates disappear and freeze for their owner', async () => {
  fails(await as(db, u.mod, `select public.moderate_template($1, 'remove', '')`, [s.tpl]), /reason is required/);
  ok(await as(db, u.mod, `select public.moderate_template($1, 'remove', 'Copyright claim')`, [s.tpl]));
  none(await as(db, null, `select id from public.templates where id = $1`, [s.tpl]));
  none(await as(db, null, `select id from public.template_files where template_id = $1`, [s.tpl]), 'files still listed');
  none(await as(db, u.alice, `update public.templates set title = 'Back again' where id = $1 returning id`, [s.tpl]));
  fails(await as(db, u.alice, `select public.create_version($1, '2.0.0')`, [s.tpl]), /removed/);
});

test('account deletion soft-deletes, unlists and hides the profile', async () => {
  const [t] = ok(await as(db, u.carol, `select count(*)::int n from public.profiles where id = $1`, [u.bob]));
  assert.equal(t.n, 1);
  ok(await as(db, u.bob, `select public.delete_my_account()`));
  none(await as(db, u.carol, `select id from public.profiles where id = $1`, [u.bob]));
  fails(await as(db, u.bob, `select * from public.create_template('After deletion', $1::smallint)`, [s.websites]), /deleted/);
});

test('URLs: valid ones are accepted, dangerous or off-allowlist ones refused', async () => {
  const [d] = ok(await as(db, u.alice, `select template_id from public.create_template('URL checks', $1::smallint)`, [s.websites]));
  const setDemo = (url) => as(db, u.alice, `update public.templates set demo_url = $2 where id = $1`, [d.template_id, url]);
  ok(await setDemo('https://demo.example.com/path?x=1'));
  fails(await setDemo('javascript:alert(1)'), /check constraint/);
  fails(await setDemo('http://insecure.example.com'), /check constraint/);
  fails(await setDemo('https://' + 'a'.repeat(600)), /check constraint/);
  // Live demos must be the creator's own site, not a big platform or a link shortener.
  for (const bad of ['https://www.google.com', 'https://google.co.uk/search?q=x', 'https://m.facebook.com/page',
                     'https://youtu.be/abc', 'https://www.youtube.com/watch?v=1', 'https://bit.ly/x', 'https://x.com/someone', 'https://GOOGLE.COM']) {
    fails(await setDemo(bad), /live demo/, bad);
  }
  for (const good of ['https://me.vercel.app', 'https://myname.github.io/site', 'https://notgoogle.com', 'https://google.example.com']) {
    ok(await setDemo(good), good);
  }
  const addLink = (kind, url) => as(db, u.alice,
    `insert into public.template_links (template_id, kind, url) values ($1, $2, $3)`, [d.template_id, kind, url]);
  ok(await addLink('figma', 'https://www.figma.com/community/file/123/name'));
  ok(await addLink('canva', 'https://www.canva.com/design/DAGabc/view'));
  fails(await addLink('github', 'https://evil.example.com/github.com/a/b'), /check constraint/);
  fails(await addLink('github', 'https://github.com.evil.dev/a/b'), /check constraint/);
  fails(await as(db, u.bob, `insert into public.template_links (template_id, kind, url) values ($1, 'github', 'https://github.com/a/b')`,
                 [d.template_id]), /row-level security/, 'link on someone else template');
});

test('creator analytics only ever cover your own templates', async () => {
  const mine = ok(await as(db, u.alice, `select sum(likes)::int l, sum(votes)::int v from public.creator_analytics(30, null)`));
  assert.ok(mine[0].l >= 1, 'alice sees likes on her templates');
  const other = ok(await as(db, u.carol, `select sum(likes)::int l, sum(votes)::int v, sum(downloads)::int d from public.creator_analytics(30, $1)`, [s.tpl]));
  assert.equal(other[0].l, 0, 'carol gets zeros for alice template');
  assert.equal(other[0].d, 0);
  fails(await as(db, null, `select * from public.creator_analytics(30, null)`), /permission denied/);
});

test('for_you is personal and refuses anonymous callers', async () => {
  fails(await as(db, null, `select * from public.for_you(10, 0)`), /permission denied/);
  const feed = ok(await as(db, u.carol, `select template_id, reason from public.for_you(10, 0)`));
  const own = ok(await as(db, u.carol, `select id from public.templates where owner_id = $1`, [u.carol]));
  assert.ok(!feed.some((f) => own.some((o) => o.id === f.template_id)), 'own templates excluded');
});

test('ranking: most votes in the period wins, with a minimum, once per template', async () => {
  const creator = await createUser(db, { email: 'award-creator@test.dev' });
  const rival = await createUser(db, { email: 'award-rival@test.dev' });
  const mk = async (owner, title) => {
    const [r] = ok(await as(db, owner, `select * from public.create_template($1, $2::smallint)`, [title, s.websites]));
    await db.query(`update public.templates set status = 'published', published_at = '2029-12-01' where id = $1`, [r.template_id]);
    return r.template_id;
  };
  const popular = await mk(creator, 'Six votes on the day');
  const second = await mk(creator, 'Four votes on the day');
  const few = await mk(rival, 'Three votes on the day');
  const voters = [];
  for (let i = 0; i < 6; i++) voters.push(await createUser(db, { email: `voter${i}@test.dev` }));
  const castAt = (voter, tpl, at) =>
    db.query(`insert into public.votes (user_id, template_id, created_at) values ($1, $2, $3)`, [voter, tpl, at]);
  for (const v of voters) await castAt(v, popular, '2030-01-01 10:00Z');
  for (const v of voters.slice(0, 4)) await castAt(v, second, '2030-01-01 11:00Z');
  for (const v of voters.slice(0, 3)) await castAt(v, few, '2030-01-01 12:00Z');
  await castAt(voters[5], few, '2030-01-02 09:00Z'); // next day: must not count for Jan 1

  const [{ grant_award: first }] = await sql(`select public.grant_award('day', '2030-01-01'::date)`);
  const [a1] = await sql(`select template_id, period_votes, score_snapshot from public.awards where id = $1`, [first]);
  assert.equal(a1.template_id, popular, 'most votes that day wins');
  assert.equal(a1.period_votes, 6);
  assert.equal(a1.score_snapshot, null);
  const [{ grant_award: next }] = await sql(`select public.grant_award('day', '2030-01-02'::date)`);
  assert.equal(next, null, 'one vote on Jan 2 is under the 3-vote minimum');
  await assert.rejects(db.query(`update public.awards set period_votes = 99 where id = $1`, [first]), /immutable/);
  fails(await as(db, u.alice, `select public.grant_award('day', current_date)`), /permission denied/);
  const notes = await sql(`select count(*)::int n from public.notifications where user_id = $1 and type = 'award'`, [creator]);
  assert.equal(notes[0].n, 1);

  // Dev of the Week sums votes across a creator's templates (6 + 4 beats 3 + 1).
  fails(await as(db, u.alice, `select public.grant_dev_of_week('2029-12-31')`), /permission denied/);
  await assert.rejects(db.query(`select public.grant_dev_of_week('2030-01-01')`), /Monday/);
  const [{ grant_dev_of_week: dev }] = await sql(`select public.grant_dev_of_week('2029-12-31')`);
  const [d] = await sql(`select user_id, vote_count, template_count from public.dev_awards where id = $1`, [dev]);
  assert.deepEqual({ ...d }, { user_id: creator, vote_count: 10, template_count: 2 });
  const [{ grant_dev_of_week: twice }] = await sql(`select public.grant_dev_of_week('2029-12-31')`);
  assert.equal(twice, null, 'one Dev of the Week per week');
  await assert.rejects(db.query(`update public.dev_awards set vote_count = 1`), /immutable/);
  const pub = ok(await as(db, null, `select user_id from public.dev_awards`));
  assert.equal(pub.length, 1, 'winners are public');
});

test('template limit: 7 per account, enforced in the database, freed by deleting a draft', async () => {
  const maker = await createUser(db, { email: 'limit@test.dev' });
  const mk = (n) => as(db, maker, `select template_id from public.create_template($1, $2::smallint)`, [`Limit test ${n}`, s.websites]);
  const ids = [];
  for (let i = 1; i <= 7; i++) ids.push(ok(await mk(i))[0].template_id);
  fails(await mk(8), /up to 7 templates/, 'eighth template');
  const [slots] = ok(await as(db, maker, `select * from public.my_template_slots()`));
  assert.deepEqual({ ...slots }, { used: 7, max: 7, unlimited: false });
  ok(await as(db, maker, `delete from public.templates where id = $1`, [ids[0]]));
  ok(await mk(9), 'a deleted draft frees its slot');
  fails(await as(db, maker, `insert into public.templates (owner_id, slug, title) values ($1, 'sneak-8', 'Sneak')`, [maker]),
        /permission denied/, 'no way around create_template');
});

test('creator search: finds by name, username or skill; wildcards are literal', async () => {
  const dev = await createUser(db, { email: 'zed@test.dev', meta: { user_name: 'zed_builds', full_name: 'Zed Okafor' } });
  await db.query(`update public.profiles set skills = '{Flutter,Motion}' where id = $1`, [dev]);
  const find = async (q) => ok(await as(db, null, `select username from public.search_creators($1, 24)`, [q])).map((r) => r.username);
  assert.ok((await find('okafor')).includes('zed_builds'), 'display name');
  assert.ok((await find('@zed_b')).includes('zed_builds'), 'username with @');
  assert.ok((await find('flutter')).includes('zed_builds'), 'skill');
  assert.deepEqual(await find('%%'), [], '% is not a wildcard');
  assert.ok(!(await find('z_d')).includes('zed_builds'), '_ is not a wildcard (would match "zed")');
  assert.deepEqual(await find('z'), [], 'at least 2 characters');
});

test('scan queue: a file that crashes the scanner 3 times is rejected, not stuck forever', async () => {
  const owner = await createUser(db, { email: 'scan-owner@test.dev' });
  const [d] = ok(await as(db, owner, `select template_id, version_id from public.create_template('Scan retry test', $1::smallint)`, [s.websites]));
  const [{ path }] = ok(await as(db, owner, `select public.prepare_file_upload($1, 'a.zip', 1000) as path`, [d.version_id]));
  const [{ register_file: file }] = ok(await as(db, owner, `select public.register_file($1, $2, 'a.zip', 1000)`, [d.version_id, path]));

  fails(await as(db, owner, `select public.scan_queue_size()`), /permission denied/, 'users cannot read the queue');
  const [{ scan_queue_size: before }] = ok(await as(db, 'service', `select public.scan_queue_size()`));
  assert.ok(before >= 1);

  // Three claims that each "crash" (never call complete_scan), 15+ minutes apart.
  for (let i = 0; i < 3; i++) {
    const claimed = ok(await as(db, 'service', `select id from public.claim_scan_jobs(10)`));
    assert.ok(claimed.some((c) => c.id === file), `attempt ${i + 1} claims the file`);
    await db.query(`update public.template_files set scan_started_at = now() - interval '16 minutes' where id = $1`, [file]);
  }
  const claimedAgain = ok(await as(db, 'service', `select id from public.claim_scan_jobs(10)`));
  assert.ok(!claimedAgain.some((c) => c.id === file), 'not claimed a fourth time');
  const [f] = await sql(`select scan_status, reject_reason from public.template_files where id = $1`, [file]);
  assert.equal(f.scan_status, 'rejected');
  assert.match(f.reject_reason, /upload it again/);
  const [n] = await sql(`select count(*)::int n from public.notifications where user_id = $1 and type = 'scan_failed'`, [owner]);
  assert.equal(n.n, 1, 'the creator is told');
});

test('live standings expose counts, never voters', async () => {
  const rows = ok(await as(db, null, `select * from public.ranking_templates('week', 5)`));
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['template_id', 'votes']);
  const devs = ok(await as(db, null, `select * from public.ranking_devs(5)`));
  for (const r of devs) assert.deepEqual(Object.keys(r).sort(), ['templates', 'user_id', 'votes']);
});

test('deleting a draft returns every object key so R2 can be cleaned up', async () => {
  const [d] = ok(await as(db, u.alice, `select template_id, version_id from public.create_template('Throwaway draft', $1::smallint)`, [s.websites]));
  const [{ path }] = ok(await as(db, u.alice, `select public.prepare_file_upload($1, 'a.zip', 1000) as path`, [d.version_id]));
  ok(await as(db, u.alice, `select public.register_file($1, $2, 'a.zip', 1000)`, [d.version_id, path]));
  const [{ path: img }] = ok(await as(db, u.alice, `select public.prepare_media_upload($1, 'image/png', 1000) as path`, [d.template_id]));
  ok(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', 'Throwaway cover', 10, 10)`, [d.template_id, img]));
  fails(await as(db, u.bob, `select * from public.delete_draft_template($1)`, [d.template_id]), /Template not found/);
  const keys = ok(await as(db, u.alice, `select * from public.delete_draft_template($1)`, [d.template_id]));
  assert.deepEqual(keys.map((k) => k.bucket).sort(), ['media', 'quarantine']);
  assert.ok(keys.some((k) => k.storage_path === path) && keys.some((k) => k.storage_path === img));
  none(await as(db, u.alice, `select id from public.templates where id = $1`, [d.template_id]), 'draft gone');
  fails(await as(db, u.alice, `select * from public.delete_draft_template($1)`, [s.tpl]), /Template not found|Only drafts/, 'published template');
});
