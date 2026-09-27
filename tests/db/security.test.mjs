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

// Simulates the Storage API writing an object on the user's behalf (RLS applies).
// No RETURNING: that would also require a SELECT policy, and quarantine has none on purpose.
const upload = (uid, bucket, path, size = 1000) =>
  as(db, uid, `insert into storage.objects (bucket_id, name, owner_id, metadata)
               values ($1, $2, $3, jsonb_build_object('size', $4::bigint))`,
     [bucket, path, uid, size]);

before(async () => {
  db = await createDb();
  u.alice = await createUser(db, { email: 'alice@test.dev', meta: { user_name: 'alice' } }); // creator
  u.bob = await createUser(db, { email: 'bob@test.dev', meta: { user_name: 'bob' } });       // voter
  u.carol = await createUser(db, { email: 'carol@test.dev' });                                // bystander
  u.newbie = await createUser(db, { email: 'newbie@test.dev', ageDays: 1 });
  u.unverified = await createUser(db, { email: 'unverified@test.dev', verified: false });
  u.mod = await createUser(db, { email: 'mod@test.dev' });
  await db.query(`insert into public.user_roles (user_id, role) values ($1, 'moderator')`, [u.mod]);
  s.websites = (await sql(`select id from public.categories where slug = 'websites'`))[0].id;
});

// ─────────────────────────────────────────────── defaults
test('anon cannot read private tables', async () => {
  for (const t of ['votes', 'downloads', 'notifications', 'reports', 'moderation_log',
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

test('storage: uploads only into your own draft version path', async () => {
  const good = `${u.alice}/${s.tpl}/${s.ver}/11111111-1111-4111-8111-111111111111.zip`;
  ok(await upload(u.alice, 'quarantine', good, 5_000_000));
  s.zipPath = good;
  fails(await upload(u.bob, 'quarantine', `${u.bob}/${s.tpl}/${s.ver}/22222222-2222-4222-8222-222222222222.zip`),
        /row-level security/, 'bob into alice template');
  fails(await upload(u.bob, 'quarantine', `${u.alice}/${s.tpl}/${s.ver}/33333333-3333-4333-8333-333333333333.zip`),
        /row-level security/, 'bob with alice prefix');
  fails(await upload(u.bob, 'template-files', `${u.bob}/x.zip`), /row-level security/, 'direct to clean bucket');
  none(await as(db, u.alice, `select name from storage.objects where bucket_id = 'quarantine'`), 'quarantine readable');
});

test('register_file trusts storage for size and validates the path', async () => {
  fails(await as(db, u.bob, `select public.register_file($1, $2, 'x.zip')`, [s.ver, s.zipPath]), /Version not found/);
  fails(await as(db, u.alice, `select public.register_file($1, $2, 'x.zip')`,
                 [s.ver, `${u.alice}/${s.tpl}/${s.ver}/99999999-9999-4999-8999-999999999999.zip`]), /Upload not found/);
  fails(await as(db, u.alice, `select public.register_file($1, $2, 'evil.exe')`,
                 [s.ver, `${u.alice}/${s.tpl}/${s.ver}/11111111-1111-4111-8111-111111111111.exe`]), /not allowed/);
  const [r] = ok(await as(db, u.alice, `select public.register_file($1, $2, 'dashboard-kit.zip') as id`, [s.ver, s.zipPath]));
  s.file = r.id;
  const [f] = await sql(`select size_bytes, source_tool, scan_status from public.template_files where id = $1`, [s.file]);
  assert.equal(Number(f.size_bytes), 5_000_000);
  assert.equal(f.source_tool, 'code');
  assert.equal(f.scan_status, 'pending');
  fails(await as(db, u.alice, `update public.template_files set scan_status = 'clean' where id = $1`, [s.file]),
        /permission denied/, 'owner marks own file clean');
});

test('publish gate refuses until every requirement is met', async () => {
  const pub = () => as(db, u.alice, `select public.publish_version($1, true) as status`, [s.ver]);
  fails(await as(db, u.alice, `select public.publish_version($1, false)`, [s.ver]), /own the rights/);
  fails(await pub(), /license/);
  ok(await as(db, u.alice, `update public.template_versions set license_code = 'MIT', changelog = 'First release' where id = $1`, [s.ver]));
  fails(await pub(), /cover/);
  const cover = `${u.alice}/${s.tpl}/44444444-4444-4444-8444-444444444444.webp`;
  ok(await upload(u.alice, 'media', cover));
  fails(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', '', 1600, 1000)`, [s.tpl, cover]),
        /alt_text/, 'empty alt text');
  ok(await as(db, u.alice, `select public.register_media($1, $2, 'cover', 'desktop', 'Dark analytics dashboard with MRR chart', 1600, 1000)`, [s.tpl, cover]));
  fails(await pub(), /malware scan/, 'file still pending');

  // Worker claims and completes the scan with the service role.
  const [job] = ok(await as(db, 'service', `select * from public.claim_scan_jobs(5)`));
  assert.equal(job.id, s.file);
  ok(await as(db, 'service', `select public.complete_scan($1, 'clean', $2, $3, '{"entries": 3}'::jsonb, '{}'::jsonb, null)`,
              [s.file, `${u.alice}/${s.tpl}/${s.ver}/dashboard-kit.zip`, 'a'.repeat(64)]));

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
test('voting rules: no self-votes, no new or unverified accounts, one vote each', async () => {
  const vote = (uid, code = null) => as(db, uid,
    `insert into public.votes (template_id, design, usability, creativity, code_quality) values ($1, 9, 8, 8, $2)`, [s.tpl, code]);
  fails(await vote(u.alice), /row-level security/, 'self vote');
  fails(await vote(u.newbie), /row-level security/, '1-day-old account');
  fails(await vote(u.unverified), /row-level security/, 'unverified');
  fails(await vote(null), /permission denied/, 'anon');
  ok(await vote(u.bob, 9));
  fails(await vote(u.bob), /duplicate key/, 'double vote');
  fails(await as(db, u.carol, `insert into public.votes (user_id, template_id, design, usability, creativity)
                               values ($1, $2, 1, 1, 1)`, [u.bob, s.tpl]), /permission denied/, 'vote as someone else');
  none(await as(db, u.carol, `select * from public.votes`), 'carol reads bob vote');
  const [e] = ok(await as(db, u.newbie, `select public.vote_eligibility($1) as e`, [s.tpl]));
  assert.equal(e.e, 'too_new');
});

test('vote stats stay consistent through edits', async () => {
  ok(await as(db, u.carol, `insert into public.votes (template_id, design, usability, creativity) values ($1, 6, 6, 6)`, [s.tpl]));
  ok(await as(db, u.bob, `update public.votes set design = 10 where template_id = $1`, [s.tpl]));
  fails(await as(db, u.bob, `update public.votes set weight = 50 where template_id = $1`, [s.tpl]), /permission denied/);
  const [st] = await sql(`select vote_count, weight_sum, score_sum, design_sum from public.template_stats where template_id = $1`, [s.tpl]);
  const [agg] = await sql(`select count(*)::int n, sum(score * weight) s, sum(design * weight) d from public.votes where template_id = $1`, [s.tpl]);
  assert.equal(st.vote_count, agg.n);
  assert.equal(Number(st.score_sum), Number(agg.s));
  assert.equal(Number(st.design_sum), Number(agg.d));
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

test('reports are private to the reporter and moderators', async () => {
  ok(await as(db, u.bob, `insert into public.reports (target_type, target_id, reason) values ('template', $1, 'broken')`, [s.tpl]));
  none(await as(db, u.alice, `select id from public.reports`));
  assert.equal(ok(await as(db, u.mod, `select id from public.reports`)).length, 1);
  fails(await as(db, u.bob, `update public.reports set status = 'resolved'`), /permission denied/);
});

// ─────────────────────────────────────────────── versions, yanks, awards
test('yanking keeps history and blocks downloads of the pulled version', async () => {
  fails(await as(db, u.alice, `select public.yank_version($1, 'broken')`, [s.ver]), /replacement/);
  fails(await as(db, u.alice, `select public.create_version($1, '0.9.0')`, [s.tpl]), /greater than/);
  const [v2] = ok(await as(db, u.alice, `select public.create_version($1, '1.1.0') as id`, [s.tpl]));
  const [lic] = await sql(`select license_code from public.template_versions where id = $1`, [v2.id]);
  assert.equal(lic.license_code, 'MIT', 'license carried forward');
  const v2path = `${u.alice}/${s.tpl}/${v2.id}/55555555-5555-4555-8555-555555555555.fig`;
  ok(await upload(u.alice, 'quarantine', v2path, 2_000_000));
  const [f2] = ok(await as(db, u.alice, `select public.register_file($1, $2, 'nocturne.fig') as id`, [v2.id, v2path]));
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

test('awards: Bayesian winner, minimum votes, and one win per template', async () => {
  // Fresh, isolated set-up: two published templates, one with many strong votes, one with few perfect ones.
  const creator = await createUser(db, { email: 'award-creator@test.dev' });
  await db.query(`update public.profiles set trust_level = 1 where id = $1`, [creator]);
  const mk = async (title) => {
    const [r] = ok(await as(db, creator, `select * from public.create_template($1, $2::smallint)`, [title, s.websites]));
    await db.query(`update public.templates set status = 'published', published_at = now() - interval '1 day' where id = $1`, [r.template_id]);
    return r.template_id;
  };
  const strong = await mk('Many strong votes');
  const lucky = await mk('Three perfect votes');
  const voters = [];
  for (let i = 0; i < 12; i++) voters.push(await createUser(db, { email: `voter${i}@test.dev` }));
  for (const v of voters) await db.query(`insert into public.votes (user_id, template_id, design, usability, creativity) values ($1, $2, 9, 9, 9)`, [v, strong]);
  for (const v of voters.slice(0, 3)) await db.query(`insert into public.votes (user_id, template_id, design, usability, creativity) values ($1, $2, 10, 10, 10)`, [v, lucky]);

  const day = '2030-01-01';
  await db.query(`update public.templates set published_at = '2029-12-31' where id = any($1)`, [[strong, lucky]]);
  const [{ grant_award: first }] = await sql(`select public.grant_award('day', $1::date)`, [day]);
  const [a1] = await sql(`select template_id from public.awards where id = $1`, [first]);
  assert.equal(a1.template_id, strong, '12 strong votes beat 3 perfect ones (and 3 is under the 10-vote minimum)');

  const [{ grant_award: second }] = await sql(`select public.grant_award('day', '2030-01-02'::date)`);
  assert.equal(second, null, 'the same template cannot win the day award twice, and the other lacks votes');
  fails(await as(db, u.alice, `select public.grant_award('day', current_date)`), /permission denied/);
  const notes = await sql(`select count(*)::int n from public.notifications where user_id = $1 and type = 'award'`, [creator]);
  assert.equal(notes[0].n, 1);
});
