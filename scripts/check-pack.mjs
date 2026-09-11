// Verify the packed npm artifact under Node alone.
//
// The script runs `npm pack`, inspects the file list, checks the shipped
// JavaScript for Bun APIs and unresolved aliases, installs the tarball into a
// fresh temporary project, imports the package from there, and runs the CLI
// through the installed `bin`. It exits non-zero on the first failure.
//
// Usage: node scripts/check-pack.mjs        (after `bun run build`)
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function step(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) process.exit(1);
}

const packDir = await mkdtemp(join(tmpdir(), 'waverune-pack-'));
const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

// 1. Pack and inspect the file list. `--ignore-scripts` skips `prepack`, so
//    this checks the dist/ that the caller built, not a fresh one.
const packJson = JSON.parse(
  sh(NPM, ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], { cwd: ROOT }),
);
const [pack] = packJson;
const files = pack.files.map((f) => f.path).toSorted();
const tarball = join(packDir, pack.filename);
console.log(`packed ${pack.filename}: ${files.length} files, ${pack.unpackedSize} bytes unpacked`);

step(
  'only intended files are included',
  files.every(
    (f) => f === 'package.json' || f === 'README.md' || f === 'LICENSE' || f.startsWith('dist/'),
  ),
  files
    .filter(
      (f) =>
        !(f === 'package.json' || f === 'README.md' || f === 'LICENSE' || f.startsWith('dist/')),
    )
    .join(', '),
);
step(
  'no TypeScript source is included',
  files.every((f) => !f.endsWith('.ts') || f.endsWith('.d.ts')),
);
step(
  'no source maps, tests or bench files are included',
  files.every((f) => !/\.map$|^tests\/|^bench\/|^src\//.test(f)),
);
for (const required of [
  'dist/index.js',
  'dist/bin.js',
  'dist/index.d.ts',
  'dist/types.d.ts',
  'README.md',
  'LICENSE',
]) {
  step(`${required} is included`, files.includes(required));
}
step(
  'declaration files are included',
  files.some((f) => f.endsWith('.d.ts')),
);

// 2. Inspect the shipped code.
const jsFiles = files.filter((f) => f.endsWith('.js'));
const dtsFiles = files.filter((f) => f.endsWith('.d.ts'));
for (const file of [...jsFiles, ...dtsFiles]) {
  const source = await readFile(join(ROOT, file), 'utf8');
  step(
    `${file} has no Bun runtime API`,
    !/\bBun\.[A-Za-z]/.test(source) && !/from\s+['"]bun(:|['"])/.test(source),
  );
  step(`${file} has no unresolved ~/ alias`, !/(['"])~\/[^'"]+\1/.test(source));
}
const bin = await readFile(join(ROOT, manifest.bin.waverune), 'utf8');
step('CLI shebang targets node', bin.startsWith('#!/usr/bin/env node\n'));
if (process.platform !== 'win32') {
  const mode = (await stat(join(ROOT, manifest.bin.waverune))).mode;
  step('CLI file is executable', (mode & 0o111) !== 0, `mode ${(mode & 0o777).toString(8)}`);
}
step(
  'package.json entries point at dist/',
  [manifest.main, manifest.types, manifest.bin.waverune, manifest.exports['.'].import].every((p) =>
    p.includes('dist/'),
  ),
);
step('engines.node requires 22 or later', /^>=\s*22/.test(manifest.engines?.node ?? ''));

// 3. Install the tarball into a fresh project and use it as a consumer.
const consumer = await mkdtemp(join(tmpdir(), 'waverune-consumer-'));
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
);
sh(NPM, ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], { cwd: consumer });
step('tarball installs with npm', true);

const importProbe = `
import { embed, detect, crc32, PerceptualWatermarker } from 'waverune';
const sr = 44100; const n = sr * 5; const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * i / sr)) + 0.1 * Math.sin(2 * Math.PI * 1500 * i / sr);
const marked = embed({ sampleRate: sr, channels: [x] }, { key: 'pack', payload: 99n });
const result = detect(marked, { key: 'pack' });
console.log(JSON.stringify({ detected: result.detected, payload: String(result.payload), crc: crc32(new TextEncoder().encode('123456789')), cls: typeof PerceptualWatermarker }));
`;
await writeFile(join(consumer, 'probe.mjs'), importProbe);
const probe = JSON.parse(sh(process.execPath, ['probe.mjs'], { cwd: consumer }).trim());
step('importing from Node succeeds', probe.cls === 'function');
step(
  'embed and detect work from the installed package',
  probe.detected === true && probe.payload === '99',
  JSON.stringify(probe),
);
step('crc32 from the installed package matches the check value', probe.crc === 0xcbf43926);

// 4. Run the installed CLI through the bin link.
const wavProbe = `
import { writeWavFile } from 'waverune';
const sr = 44100; const n = sr * 5; const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * i / sr)) + 0.1 * Math.sin(2 * Math.PI * 1500 * i / sr);
await writeWavFile(process.argv[2], { sampleRate: sr, channels: [x] });
`;
await writeFile(join(consumer, 'wav.mjs'), wavProbe);
const input = join(consumer, 'input.wav');
const output = join(consumer, 'output.wav');
sh(process.execPath, ['wav.mjs', input], { cwd: consumer });
const binPath = join(
  consumer,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'waverune.cmd' : 'waverune',
);
const embedOut = JSON.parse(
  sh(binPath, ['embed', input, '-o', output, '--id', '7', '--key', 'pack', '--json'], {
    cwd: consumer,
  }),
);
step(
  'packaged CLI embed runs under Node and verifies',
  embedOut.verified === true && embedOut.recoveredId === '7',
);
const detectOut = JSON.parse(
  sh(binPath, ['detect', output, '--key', 'pack', '--json'], { cwd: consumer }),
);
step('packaged CLI detect recovers the id', detectOut.detected === true && detectOut.id === '7');
const npxOut = JSON.parse(
  sh(NPM, ['exec', '--no', '--', 'waverune', 'detect', output, '--key', 'pack', '--json'], {
    cwd: consumer,
  }),
);
step('npm exec waverune resolves the installed bin', npxOut.id === '7');

console.log(`\nall pack checks passed for ${pack.filename}`);
