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

test('sub-admins: granted by an admin to a follower, may only approve or request changes; staff are notified', async () => {
  const boss = await createUser(db, { email: 'boss@test.dev' });
  const fan = await createUser(db, { email: 'fan@test.dev' });
  const stranger = await createUser(db, { email: 'stranger@test.dev' });
  const maker = await createUser(db, { email: 'maker@test.dev' });
  await sql(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [boss]);
  ok(await as(db, fan, `insert into public.follows (followee_id) values ($1)`, [boss]));

  // Only admins grant it, only to their followers, and nobody grants it to themselves.
  fails(await as(db, u.mod, `select public.set_sub_admin($1, true)`, [fan]), /Admins only/);
  fails(await as(db, fan, `select public.set_sub_admin($1, true)`, [fan]), /Admins only/);
  fails(await as(db, boss, `select public.set_sub_admin($1, true)`, [stranger]), /follow you/);
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
