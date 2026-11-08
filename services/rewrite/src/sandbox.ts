// Compiles and runs Nemotron's Java inside Docker (eclipse-temurin JDK): no network, capped memory and time,
// inputs mounted read-only. Generated code never runs on the host.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const JDK_IMAGE = 'eclipse-temurin:21-jdk';

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('docker', args);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
  });
}

const base = (work: string, scenarios?: string) => ['run', '--rm', '--network', 'none', '--memory', '1g', '--cpus', '2', '--pids-limit', '256',
  '-v', `${work}:/w`, ...(scenarios ? ['-v', `${scenarios}:/data:ro`] : []), JDK_IMAGE, 'sh', '-c'];

export async function compile(work: string, java: string): Promise<{ ok: boolean; log: string }> {
  rmSync(join(work, 'classes'), { recursive: true, force: true });
  mkdirSync(join(work, 'classes'), { recursive: true });
  writeFileSync(join(work, 'Main.java'), java);
  const r = await docker([...base(work), 'javac -encoding UTF-8 -nowarn -d /w/classes /w/Main.java > /w/javac.txt 2>&1; echo $? > /w/javac.rc'], 120_000);
  const rc = existsSync(join(work, 'javac.rc')) ? Number(readFileSync(join(work, 'javac.rc'), 'utf8').trim()) : 1;
  return { ok: rc === 0, log: (existsSync(join(work, 'javac.txt')) ? readFileSync(join(work, 'javac.txt'), 'utf8') : r.out).slice(0, 8000) };
}

/**
 * Runs the compiled Main once per scenario. Each scenario gets a writable copy of the same input files the COBOL
 * run loaded (stage/<program>/sc/<scenario>/data/<DD>.txt), the same PARM, and the same fixed clock.
 */
export async function runScenarios(work: string, stageSc: string, scenarios: string[], dds: string[]): Promise<Record<string, { stdout: string; stderr: string; rc: number; ms: number }>> {
  const exports = dds.map((dd) => `DD_${dd.replace(/[^A-Z0-9_]/gi, '_')}=/w/files/$sc/${dd}.txt`).join(' ');
  const script = [
    'cd /w && rm -rf out files && mkdir -p out',
    `for sc in ${scenarios.join(' ')}; do`,
    '  mkdir -p files/$sc && cp /data/$sc/data/*.txt files/$sc/ 2>/dev/null',
    '  ( . /data/$sc/env.sh',
    // COB_CURRENT_DATE is "YYYY/MM/DD HH:MM:SS"; FUNCTION CURRENT-DATE in the same run returned YYYYMMDDHHMMSS00+0000.
    '    D=$(echo "$COB_CURRENT_DATE" | tr -d "/: ")00+0000',
    '    s=$(date +%s%N)',
    `    env ${exports} THESEUS_PARM="$THESEUS_PARM" THESEUS_CURRENT_DATE="$D" timeout 30 java -Xmx512m -cp /w/classes Main > out/$sc.txt 2> out/$sc.err; echo $? > out/$sc.rc`,
    '    echo $(( ($(date +%s%N) - s) / 1000000 )) > out/$sc.ms )',
    'done',
  ].join('\n');
  await docker([...base(work, stageSc), script], 60_000 + scenarios.length * 35_000);
  const out: Record<string, { stdout: string; stderr: string; rc: number; ms: number }> = {};
  for (const sc of scenarios) {
    const f = (ext: string) => join(work, 'out', `${sc}.${ext}`);
    out[sc] = {
      stdout: existsSync(f('txt')) ? readFileSync(f('txt'), 'utf8').slice(0, 400_000) : '',
      stderr: existsSync(f('err')) ? readFileSync(f('err'), 'utf8').slice(0, 4000) : '',
      rc: existsSync(f('rc')) ? Number(readFileSync(f('rc'), 'utf8').trim()) : -1,
      ms: existsSync(f('ms')) ? Number(readFileSync(f('ms'), 'utf8').trim()) : 0,
    };
  }
  return out;
}

export const scenarioNames = (stageSc: string) => (existsSync(stageSc) ? readdirSync(stageSc).filter((d) => existsSync(join(stageSc, d, 'env.sh'))).sort() : []);
