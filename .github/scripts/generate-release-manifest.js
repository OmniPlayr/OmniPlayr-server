const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const outputDir = process.env.OMNIPLAYR_RELEASE_OUTPUT_DIR
  ? path.resolve(repoRoot, process.env.OMNIPLAYR_RELEASE_OUTPUT_DIR)
  : path.join(repoRoot, '.github', 'release-output');

const directories = [
  { group: 'backend', path: 'backend/api' },
  { group: 'backend', path: 'backend/config_defaults' },
  { group: 'backend', path: 'backend/config_types' },
  { group: 'backend', path: 'backend/omniplayr' },
  { group: 'frontend', path: 'frontend/public' },
  { group: 'frontend', path: 'frontend/scripts' },
  { group: 'frontend-src', path: 'frontend/src' },
  { group: 'root', path: 'composers' },
  { group: 'root', path: 'setup' },
];

const files = [
  { group: 'backend', path: 'backend/config.json' },
  { group: 'backend', path: 'backend/Dockerfile' },
  { group: 'backend', path: 'backend/main.py' },
  { group: 'backend', path: 'backend/requirements.txt' },
  { group: 'frontend', path: 'frontend/.gitignore' },
  { group: 'frontend', path: 'frontend/Dockerfile' },
  { group: 'frontend', path: 'frontend/Dockerfile.dev' },
  { group: 'frontend', path: 'frontend/eslint.config.js' },
  { group: 'frontend', path: 'frontend/index.html' },
  { group: 'frontend', path: 'frontend/proxy.js' },
  { group: 'frontend', path: 'frontend/tsconfig.app.json' },
  { group: 'frontend', path: 'frontend/tsconfig.json' },
  { group: 'frontend', path: 'frontend/tsconfig.node.json' },
  { group: 'frontend', path: 'frontend/vite.config.ts' },
  { group: 'root', path: '.gitattributes' },
  { group: 'root', path: '.gitignore' },
  { group: 'root', path: 'docker-compose.yml' },
  { group: 'root', path: 'Dockerfile' },
  { group: 'root', path: 'setup.py' },
];

function toRepoPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function parseFrontendVersion() {
  const content = fs.readFileSync(path.join(repoRoot, 'frontend/src/config/version.toml'), 'utf8');
  const frontend = {};
  let inFrontendSection = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inFrontendSection = line === '[version.frontend]';
      continue;
    }
    if (!inFrontendSection || !line.includes('=')) continue;

    const [rawKey, ...rawValueParts] = line.split('=');
    const key = rawKey.trim();
    let value = rawValueParts.join('=').trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (/^-?\d+$/.test(value)) {
      value = Number(value);
    }
    frontend[key] = value;
  }

  return frontend;
}

function shouldSkip(relativePath, isDirectory = false) {
  const parts = relativePath.split('/');
  if (parts.includes('__pycache__')) return true;
  if (relativePath.endsWith('.pyc') || relativePath.endsWith('.pyo')) return true;

  if (relativePath.startsWith('frontend/src/')) {
    const srcChild = parts[2];
    if (srcChild === 'local-plugins') return true;
    if (srcChild === 'plugins') return true;
    if (isDirectory && relativePath === 'frontend/src/config') return false;
    if (srcChild === 'config' && relativePath !== 'frontend/src/config/version.toml') return true;
  }

  return false;
}

function collectDirectory(group, relativeDir, collected) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return;

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
    if (shouldSkip(relativePath, entry.isDirectory())) continue;

    if (entry.isDirectory()) {
      collectDirectory(group, relativePath, collected);
    } else if (entry.isFile()) {
      collected.set(relativePath, group);
    }
  }
}

function collectFiles() {
  const collected = new Map();

  for (const directory of directories) {
    collectDirectory(directory.group, directory.path, collected);
  }

  for (const file of files) {
    const absolutePath = path.join(repoRoot, file.path);
    if (fs.existsSync(absolutePath) && !shouldSkip(file.path)) {
      collected.set(file.path, file.group);
    }
  }

  return [...collected.entries()]
    .map(([relativePath, group]) => ({ path: relativePath, group }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function digestRecords(records) {
  const digest = crypto.createHash('sha256');
  for (const record of records) {
    digest.update(record.path);
    digest.update('\0');
    digest.update(record.sha256);
    digest.update('\0');
    digest.update(String(record.size));
    digest.update('\n');
  }
  return digest.digest('hex');
}

function main() {
  const backendVersion = readJson('backend/config.json');
  const frontendVersion = parseFrontendVersion();
  const branch = process.env.GITHUB_REF_NAME || backendVersion.branch || frontendVersion.branch || 'dev';
  const commit = process.env.GITHUB_SHA || '';

  const records = collectFiles().map((entry) => {
    const absolutePath = path.join(repoRoot, entry.path);
    const contents = fs.readFileSync(absolutePath);
    return {
      path: entry.path,
      group: entry.group,
      size: contents.length,
      sha256: sha256(contents),
    };
  });

  const groups = {};
  for (const group of [...new Set(records.map((record) => record.group))].sort()) {
    groups[group] = {
      fileCount: records.filter((record) => record.group === group).length,
      sha256: digestRecords(records.filter((record) => record.group === group)),
    };
  }

  const backendSafeVersion = String(backendVersion.safeVersion || backendVersion.version || '0.0.0');
  const frontendSafeVersion = String(frontendVersion.safeVersion || '0.0.0');
  const tagBranch = branch.replace(/[^A-Za-z0-9._-]+/g, '-');
  const tagName = `${tagBranch}-backend-${backendSafeVersion}_frontend-${frontendSafeVersion}`;

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    branch,
    commit,
    tagName,
    prerelease: branch !== 'main' || backendSafeVersion.includes('dev') || frontendSafeVersion.includes('dev'),
    versions: {
      backend: backendVersion,
      frontend: frontendVersion,
    },
    sha256: digestRecords(records),
    groups,
    files: records,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'release-files.txt'), `${records.map((record) => record.path).join('\n')}\n`);
  fs.writeFileSync(path.join(outputDir, 'release-env.txt'), [
    `TAG_NAME=${tagName}`,
    `RELEASE_NAME=OmniPlayr ${backendSafeVersion} / ${frontendSafeVersion} (${branch})`,
    `PRERELEASE=${manifest.prerelease ? 'true' : 'false'}`,
    `MANIFEST_SHA256=${manifest.sha256}`,
  ].join('\n') + '\n');

  console.log(`Generated ${records.length} file records`);
  console.log(`Combined SHA256: ${manifest.sha256}`);
  console.log(`Release tag: ${tagName}`);
}

main();
