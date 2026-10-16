// Bu runner URL/şifre/linked Supabase almaz. Yalnız kendi geçici konteynerine bağlanır.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { runGamificationConcurrency } from "./test-gamification-concurrency.mjs";
import { runAnalysisQuotaConcurrency } from "./test-analysis-quota-concurrency.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const container = `akilli-atik-step2-${process.pid}-${Date.now()}`;
const image = "postgres:17-alpine";
const database = "akilli_atik_step2_test";
let created = false;
let phase = "environment";

function docker(args, input, quiet = false) {
  const result = spawnSync("docker", args, {
    cwd: root, encoding: "utf8", input, windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180000,
  });
  if (!quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error || result.status !== 0)
    throw new Error(`Docker ${args[0]} başarısız: ${result.error?.message ?? result.status}`);
  return result.stdout;
}

function sql(file) {
  docker(["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database,
    "--set", "ON_ERROR_STOP=1"], readFileSync(resolve(root, file), "utf8"));
}

try {
  docker(["version", "--format", "{{.Server.Version}}"]);
  docker(["run", "--detach", "--rm", "--name", container,
    "--label", "com.akilliatik.purpose=step2-isolated-test",
    "--network", "none", "--tmpfs", "/var/lib/postgresql/data",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`,
    image]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", database], undefined, true);
      ready = true;
      break;
    } catch { await setTimeout(500); }
  }
  if (!ready) throw new Error("Yerel PostgreSQL hazır olmadı");
  console.log("POSTGRESQL ENGINE / IMAGE:");
  docker(["exec", container, "psql", "-X", "-U", "postgres", "-d", database,
    "-Atc", "SELECT version()"]);
  docker(["image", "inspect", image, "--format", "{{index .RepoDigests 0}}"]);
  phase = "sql";
  sql("supabase/tests/bootstrap.sql");
  sql("supabase/migrations/20261015000100_create_waste_analyses.sql");
  sql("supabase/tests/waste_analyses.test.sql");
  sql("supabase/tests/analysis_storage.test.sql");
  sql("supabase/migrations/20261016000100_gamification.sql");
  sql("supabase/tests/gamification.test.sql");
  await runGamificationConcurrency(container, database);
  sql("supabase/migrations/20261017000100_analysis_quota.sql");
  sql("supabase/tests/analysis_quota.test.sql");
  await runAnalysisQuotaConcurrency(container, database);
  docker(["exec", container, "psql", "-X", "-U", "postgres", "-d", database,
    "--set", "ON_ERROR_STOP=1", "-c",
    "DO $$ BEGIN IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.waste_analyses) OR EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM private.xp_awards) THEN RAISE EXCEPTION 'Test rollback failed'; END IF; END $$;"]);
  console.log("PASS: Migration PostgreSQL'de uygulandı, RLS testleri geçti; fixture rollback doğrulandı.");
} catch (error) {
  console.error(`${phase === "environment" ? "BLOCKED" : "FAIL"}: ${error.message}`);
  process.exitCode = phase === "environment" ? 2 : 1;
} finally {
  if (created) {
    try { docker(["rm", "--force", container]); }
    catch { console.error(`Test konteyneri kaldı: ${container}`); process.exitCode = 1; }
  }
}
