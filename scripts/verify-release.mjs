import { readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function inspectContent(content, path = 'file') {
  const patterns = [
    /\bam_[a-f0-9]{48,}\b/i,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /market_session=[a-f0-9]{32,}/i,
    /\b(?:agent|admin)-demo-\d{4}\b/,
    /\b(?:demo|admin)@agent\.local\b/,
    /SQLite format 3\u0000/,
  ];
  if (patterns.some(pattern => pattern.test(content))) throw new Error(`Potential credential or database content in ${path}.`);
}

export function verifyRelease(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const canonicalRoot = realpathSync(root);
  const manifest = JSON.parse(readFileSync(resolve(root, 'release-manifest.json'), 'utf8'));
  if (manifest.name !== 'agent-exchange-examples' || !Array.isArray(manifest.files) || new Set(manifest.files).size !== manifest.files.length) throw new Error('Invalid release manifest.');
  for (const path of manifest.files) {
    if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) throw new Error('Invalid publication path.');
    if (/(?:^|\/)(?:data|node_modules|\.next|\.git|\.agent-market-runs|test-results)(?:\/|$)/.test(path) || /\.env(?:\.|$)/.test(path) && path !== '.env.example') throw new Error(`Private publication path: ${path}`);
    const absolute = resolve(root, path);
    const rel = relative(canonicalRoot, realpathSync(absolute));
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) throw new Error(`Publication file is not inside the example package: ${path}`);
    const body = readFileSync(absolute, 'utf8');
    inspectContent(body, path);
    if (path.endsWith('.md')) {
      for (const [, target] of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        const link = resolve(dirname(absolute), target.split('#')[0]);
        const linkRel = relative(canonicalRoot, link).split(sep).join('/');
        if (!existsSync(link) || !manifest.files.includes(linkRel)) throw new Error(`Unpublished or broken link in ${path}: ${target}`);
      }
      if ((body.match(/^```/gm) ?? []).length % 2) throw new Error(`Unbalanced Markdown fences: ${path}`);
    }
  }
  const packageFile = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (packageFile.dependencies || packageFile.devDependencies) throw new Error('Examples must remain dependency-free.');
  return { root: canonicalRoot, files: manifest.files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = verifyRelease(); console.log(`Verified ${result.files.length} publication files: links, manifest boundaries and credential patterns.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
