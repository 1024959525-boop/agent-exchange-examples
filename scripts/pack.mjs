import { mkdirSync, mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyRelease } from './verify-release.mjs';

const release = verifyRelease();
const output = resolve(release.root, '..', 'release');
mkdirSync(output, { recursive: true });
const staging = mkdtempSync(join(tmpdir(), 'agent-exchange-release-'));
try {
  const directory = join(staging, 'agent-exchange-examples');
  mkdirSync(directory);
  for (const path of release.files) {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(release.root, path), destination);
  }
  const archive = join(output, 'agent-exchange-examples.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', staging, 'agent-exchange-examples']);
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(path => !path.endsWith('/')).map(path => path.replace(/^agent-exchange-examples\//, ''));
  if (entries.length !== release.files.length || entries.some(path => !release.files.includes(path))) throw new Error('Archive does not match publication manifest.');
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(`${archive}.sha256`, `${digest}  agent-exchange-examples.tar.gz\n`);
  console.log(`Packed ${release.files.length} files: ${archive}\nSHA-256: ${digest}`);
} finally { rmSync(staging, { recursive: true, force: true }); }
