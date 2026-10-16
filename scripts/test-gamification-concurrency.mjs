// Imported only by the network-free, disposable PostgreSQL test runner.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

export async function runGamificationConcurrency(container, database) {
  if (!/^akilli-atik-step2-\d+-\d+$/.test(container) || database !== 'akilli_atik_step2_test')
    throw new Error('BLOCKED: Only the owned isolated test container is allowed.');
  const inspection = spawnSync('docker', ['inspect', container, '--format', '{{json .}}'], { encoding: 'utf8', windowsHide: true });
  if (inspection.status !== 0) throw new Error('Container verification failed.');
  const metadata = JSON.parse(inspection.stdout);
  if (metadata.HostConfig.NetworkMode !== 'none' || metadata.Config.Labels?.['com.akilliatik.purpose'] !== 'step2-isolated-test')
    throw new Error('BLOCKED: Network isolation or purpose label mismatch.');
  const id = (n) => `a1100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const user = (n) => `b2200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const users = [1,2,3,4,5,6].map(user);
  let assertions = 0;
  const check = (condition, label) => { assert.ok(condition, label); assertions++; console.log(`PASS: concurrency ${label}`); };
  function sql(text, { allowFailure = false, onData } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database,
        '-Atq', '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=sqlstate'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated SQL concurrency timeout.')); }, 45000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); onData?.(stdout); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0 && !allowFailure) reject(new Error(`Isolated SQL failed: ${stderr.slice(0, 700)}`));
        else resolve({ code, stdout: stdout.trim(), stderr });
      });
      child.stdin.end(text);
    });
  }
  const insert = (n, actor, request = id(n + 100000), date = "'2026-10-16T08:00:00Z'") =>
    `INSERT INTO public.waste_analyses(id,user_id,client_request_id,created_at,waste_name,category,description,sorting_instruction,recycling_advice,object_count,uncertain,hazardous,model)
     VALUES('${id(n)}','${actor}','${request}',${date},'Synthetic','Plastik','Synthetic','Separate','Local rules','single',false,false,'gemini-test');`;
  const authenticated = actor => `SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: actor, role: 'authenticated', is_anonymous: false })}',false); SET ROLE authenticated;`;
  try {
    await sql(`DO $$ BEGIN IF current_database()<>'akilli_atik_step2_test' OR inet_server_addr() IS NOT NULL OR
      current_setting('akilli_atik.test_database',true) IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM auth.users)
      THEN RAISE EXCEPTION 'Isolated empty fixture required'; END IF; END $$;
      INSERT INTO auth.users(id,email) VALUES ${users.map((actor,n) => `('${actor}','parallel-${n}@example.invalid')`).join(',')};`);
    await Promise.all(Array.from({ length: 20 }, (_, n) => sql(`SET ROLE service_role;${insert(100+n,user(1))}`)));
    const simultaneous = await sql(`SELECT (SELECT count(*) FROM public.waste_analyses WHERE user_id='${user(1)}')||','||count(*)||','||sum(xp) FROM private.xp_awards WHERE user_id='${user(1)}';`);
    check(simultaneous.stdout === '20,3,600', '20 independent psql connections save 20 analyses and award exactly 3');

    const duplicates = await Promise.all(Array.from({ length: 8 }, (_, n) => sql(`SET ROLE service_role;${insert(200+n,user(2),id(999999))}`, { allowFailure: true })));
    check(duplicates.filter(result => result.code === 0).length === 1 &&
      duplicates.filter(result => result.code !== 0).every(result => /23505/.test(result.stderr)), 'duplicate request race: one commit, seven unique violations');
    check((await sql(`SELECT count(*)||','||sum(xp) FROM private.xp_awards WHERE user_id='${user(2)}';`)).stdout === '1,200', 'duplicate request race awards once');

    const deleted = (await sql(`SELECT analysis_id FROM private.xp_awards WHERE user_id='${user(1)}' ORDER BY daily_slot LIMIT 1;`)).stdout;
    await sql(`${authenticated(user(1))} DELETE FROM public.waste_analyses WHERE id='${deleted}' AND user_id='${user(1)}';`);
    await sql(`SET ROLE service_role;${insert(130,user(1))}`);
    check((await sql(`SELECT count(*)||','||count(analysis_id)||','||sum(xp)FILTER(WHERE analysis_id IS NOT NULL) FROM private.xp_awards WHERE user_id='${user(1)}';`)).stdout === '3,2,400', 'delete then insert cannot reopen a consumed daily slot');

    await sql(`ALTER TABLE public.waste_analyses DISABLE TRIGGER waste_analyses_award_xp;
      ${[300,301,302,303].map(n => insert(n,user(3))).join('')}
      ${[400,401].map(n => insert(n,user(4))).join('')}
      ALTER TABLE public.waste_analyses ENABLE TRIGGER waste_analyses_award_xp;`);
    const backfill = `BEGIN; LOCK TABLE public.waste_analyses IN SHARE ROW EXCLUSIVE MODE;
      SELECT private.award_analysis(id) FROM public.waste_analyses WHERE user_id='${user(3)}' ORDER BY created_at,id; COMMIT;`;
    await Promise.all([sql(backfill),sql(backfill)]);
    check((await sql(`SELECT count(*)||','||sum(xp) FROM private.xp_awards WHERE user_id='${user(3)}';`)).stdout === '3,600', 'two concurrent historical backfills remain idempotent and respect quota');

    let locked;
    const acquired = new Promise(resolve => { locked = resolve; });
    const filling = sql(`BEGIN; LOCK TABLE public.waste_analyses IN SHARE ROW EXCLUSIVE MODE;
      SELECT 'BACKFILL_LOCKED'; SELECT pg_sleep(0.7);
      SELECT private.award_analysis(id) FROM public.waste_analyses WHERE user_id='${user(4)}' ORDER BY created_at,id; COMMIT;`,
      { onData: output => { if (output.includes('BACKFILL_LOCKED')) locked(); } });
    await Promise.race([acquired,filling.then(() => { throw new Error('Backfill ended before lock barrier.'); })]);
    let deleteFinished = false;
    const deleting = sql(`${authenticated(user(4))} DELETE FROM public.waste_analyses WHERE id='${id(400)}';`).then(value => { deleteFinished = true; return value; });
    await wait(120);
    check(!deleteFinished, 'real DELETE waits behind the backfill maintenance write lock');
    await Promise.all([filling,deleting]);
    check((await sql(`SELECT count(*)||','||count(analysis_id)||','||sum(xp)FILTER(WHERE analysis_id IS NOT NULL) FROM private.xp_awards WHERE user_id='${user(4)}';`)).stdout === '2,1,200', 'concurrent delete and backfill leave no stale active XP');
    await sql(`SET ROLE service_role;${insert(402,user(4))}${insert(403,user(4))}`);
    check((await sql(`SELECT count(*)||','||count(analysis_id) FROM private.xp_awards WHERE user_id='${user(4)}';`)).stdout === '3,2', 'backfill/delete tombstone still consumes its slot');

    const tool = readFileSync(new URL('./backfill-xp.sql', import.meta.url), 'utf8');
    await sql(`ALTER TABLE public.waste_analyses DISABLE TRIGGER waste_analyses_award_xp;${insert(600,user(6))}ALTER TABLE public.waste_analyses ENABLE TRIGGER waste_analyses_award_xp;`);
    const dryRun = await sql(tool);
    const manifest = /candidate_count=1 proposed_xp=200 manifest=([a-f0-9]{32})/.exec(dryRun.stdout)?.[1];
    check(Boolean(manifest) && (await sql(`SELECT count(*) FROM private.xp_awards WHERE user_id='${user(6)}';`)).stdout === '0', 'backfill tool defaults to read-only dry-run without awards');
    const wrongManifest = await sql(`\\set apply_xp_backfill true\n\\set expected_manifest invalid\n${tool}`, { allowFailure: true });
    check(wrongManifest.code !== 0 && /P0001/.test(wrongManifest.stderr) &&
      (await sql(`SELECT count(*) FROM private.xp_awards WHERE user_id='${user(6)}';`)).stdout === '0', 'backfill tool rejects changed or unapproved manifest before writing');
    await sql(`\\set apply_xp_backfill true\n\\set expected_manifest ${manifest}\n${tool}`);
    check((await sql(`SELECT count(*)||','||sum(xp) FROM private.xp_awards WHERE user_id='${user(6)}';`)).stdout === '1,200', 'explicit local backfill applies only approved candidates');
    const repeat = await sql(tool);
    const emptyManifest = /candidate_count=0 proposed_xp=0 manifest=([a-f0-9]{32})/.exec(repeat.stdout)?.[1];
    check(Boolean(emptyManifest), 'backfill rerun dry-run has no eligible candidates');
    await sql(`\\set apply_xp_backfill true\n\\set expected_manifest ${emptyManifest}\n${tool}`);
    check((await sql(`SELECT count(*) FROM private.xp_awards WHERE user_id='${user(6)}';`)).stdout === '1', 'explicit repeated local backfill does not duplicate XP');
    const disabledGuard = await sql(`SET akilli_atik.test_database='false';\n${tool}`, { allowFailure: true });
    check(disabledGuard.code !== 0 && /P0001/.test(disabledGuard.stderr), 'backfill tool rejects an environment without isolated-database guard');

    const nicknameRace = await Promise.all([
      sql(`${authenticated(user(5))} SELECT public.save_my_profile('Işık_Yaris',true);`, { allowFailure: true }),
      sql(`${authenticated(user(6))} SELECT public.save_my_profile('ISIK_YARIS',true);`, { allowFailure: true }),
    ]);
    check(nicknameRace.filter(result => result.code === 0).length === 1 &&
      nicknameRace.filter(result => result.code !== 0).every(result => /23505/.test(result.stderr)),
      'parallel Turkish-normalized nickname collision has one commit and one unique rejection');

    // Account deletion is deliberately raced against a maintenance transaction.
    // A deadlock rollback is acceptable; orphaned data or a quota breach is not.
    await sql(insert(500,user(5)));
    await sql(`ALTER TABLE public.waste_analyses DISABLE TRIGGER waste_analyses_award_xp;${insert(501,user(5))}ALTER TABLE public.waste_analyses ENABLE TRIGGER waste_analyses_award_xp;`);
    let accountLocked;
    const accountBarrier = new Promise(resolve => { accountLocked = resolve; });
    const accountFill = sql(`BEGIN; SET LOCAL deadlock_timeout='100ms'; LOCK TABLE public.waste_analyses IN SHARE ROW EXCLUSIVE MODE;
      SELECT 'ACCOUNT_LOCKED'; SELECT pg_sleep(0.5); SELECT private.award_analysis('${id(501)}'); COMMIT;`,
      { allowFailure: true, onData: output => { if (output.includes('ACCOUNT_LOCKED')) accountLocked(); } });
    await Promise.race([accountBarrier,accountFill.then(() => { throw new Error('Account backfill ended before lock barrier.'); })]);
    const accountDelete = sql(`SET deadlock_timeout='100ms'; DELETE FROM auth.users WHERE id='${user(5)}';`, { allowFailure: true });
    const accountResults = await Promise.all([accountFill,accountDelete]);
    console.log(JSON.stringify({ test: 'account-backfill-race', exitCodes: accountResults.map(result => result.code),
      expectedRollbackStates: accountResults.map(result => result.stderr.match(/40P01|40001/)?.[0] ?? null) }));
    check(accountResults.filter(result => result.code !== 0).every(result => /40P01|40001/.test(result.stderr)), 'account/backfill race fails only through safe transaction rollback if needed');
    await sql(`DELETE FROM auth.users WHERE id='${user(5)}';`);
    check((await sql(`SELECT (SELECT count(*) FROM public.profiles WHERE user_id='${user(5)}')||','||(SELECT count(*) FROM private.xp_awards WHERE user_id='${user(5)}');`)).stdout === '0,0', 'account cascade leaves no profile, award or tombstone');
    console.log(`GAMIFICATION_CONCURRENCY_ASSERTIONS=${assertions}`);
  } finally {
    await sql(`DELETE FROM auth.users WHERE id IN (${users.map(actor => `'${actor}'`).join(',')});`);
  }
}
