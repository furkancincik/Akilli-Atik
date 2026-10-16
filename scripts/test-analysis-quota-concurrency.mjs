// Only the disposable, network-free test database. Never accepts a connection URL.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export async function runAnalysisQuotaConcurrency(container, database) {
  assert.match(container, /^akilli-atik-step2-\d+-\d+$/);
  assert.equal(database, 'akilli_atik_step2_test');
  const inspected = spawnSync('docker', ['inspect', container, '--format', '{{json .}}'], { encoding:'utf8', windowsHide:true });
  assert.equal(inspected.status,0);
  const metadata = JSON.parse(inspected.stdout);
  assert.equal(metadata.HostConfig.NetworkMode,'none');
  assert.equal(metadata.Config.Labels['com.akilliatik.purpose'],'step2-isolated-test');
  const id = n => `c3300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  function sql(statement) {
    return new Promise((resolve,reject) => {
      const child = spawn('docker',['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-Atq','--set','ON_ERROR_STOP=1'],
        { windowsHide:true, stdio:['pipe','pipe','pipe'] });
      let output='',error='';
      const timer=setTimeout(()=>{child.kill();reject(Error('Quota concurrency timeout'));},45000);
      child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',chunk=>{error+=chunk;});
      child.on('error',reason=>{clearTimeout(timer);reject(reason);});
      child.on('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(Error(error.slice(0,800)));});
      child.stdin.end(statement);
    });
  }
  let count=0;
  const check=(ok,label)=>{assert.ok(ok,label);count++;console.log(`PASS: quota concurrency ${label}`);};
  const reserve=(user,request)=>sql(`SET ROLE service_role; SELECT public.reserve_analysis_request('${id(user)}','${id(request)}',repeat('a',64))->>'status';`);
  const clear=()=>sql(`DELETE FROM private.analysis_requests WHERE user_id IN (${Array.from({length:8},(_,n)=>`'${id(n+1)}'`).join(',')});`);
  try {
    await sql(`DO $$ BEGIN IF current_database()<>'akilli_atik_step2_test' OR inet_server_addr() IS NOT NULL OR
      current_setting('akilli_atik.test_database',true) IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM auth.users)
      THEN RAISE EXCEPTION 'Isolated empty fixture required'; END IF; END $$;
      INSERT INTO auth.users(id) VALUES ${Array.from({length:8},(_,n)=>`('${id(n+1)}')`).join(',')};`);
    const sameUser=await Promise.all(Array.from({length:8},(_,n)=>reserve(1,100+n)));
    check(sameUser.filter(x=>x==='admitted').length===1 && sameUser.filter(x=>x==='limited').length===7,'8 connections, one user, exactly one admission');
    check(await sql('SELECT count(*) FROM private.analysis_requests;')==='1','rejected concurrency does not spend additional budget');
    await clear();
    const duplicate=await Promise.all(Array.from({length:8},()=>reserve(1,200)));
    check(duplicate.filter(x=>x==='admitted').length===1 && duplicate.filter(x=>x==='duplicate').length===7,'same request race reserves once across isolates');
    check(await sql('SELECT count(*) FROM private.analysis_requests;')==='1','duplicate race has one durable ledger row');
    await clear();
    const global=await Promise.all(Array.from({length:8},(_,n)=>reserve(n+1,300+n)));
    check(global.filter(x=>x==='admitted').length===2 && global.filter(x=>x==='limited').length===6,'8 users, global active limit exactly two');
    check(await sql('SELECT count(*) FROM private.analysis_requests;')==='2','global count-and-reserve is atomic');
    console.log(`ANALYSIS_QUOTA_CONCURRENCY_ASSERTIONS=${count}`);
  } finally {
    await sql(`DELETE FROM auth.users WHERE id IN (${Array.from({length:8},(_,n)=>`'${id(n+1)}'`).join(',')});`);
  }
}
