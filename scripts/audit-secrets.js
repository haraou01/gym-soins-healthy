const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString()
  .split('\0')
  .filter(Boolean);

const blockedExtensions = ['.pem', '.key', '.p12', '.pfx', '.dump', '.zip'];
const blockedEnv = /(^|\/)\.env($|\.)/;
const allowedEnv = /(^|\/)\.env\.example$/;
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;
const awsKey = /\bAKIA[0-9A-Z]{16}\b/;
const envSecret = /^(JWT_SECRET|LICENSE_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD)\s*=\s*(.*)$/;
const allowedValues = [
  '',
  'gymsoins',
  'password_change_in_production',
  'your_jwt_secret_change_in_production',
  'your_refresh_secret_change_in_production',
  'your_license_secret_change_in_production',
  'dev-jwt-secret-change-me',
  'dev-license-secret-change-me',
  'dev-refresh-secret-change-me',
];

const findings = [];

for (const file of files) {
  const absolute = path.join(root, file);

  if (!fs.existsSync(absolute)) {
    continue;
  }

  if (
    blockedEnv.test(file) &&
    !allowedEnv.test(file)
  ) {
    findings.push({ file, reason: 'Fichier .env versionné' });
    continue;
  }

  if (blockedExtensions.some((extension) => file.endsWith(extension))) {
    findings.push({ file, reason: 'Fichier sensible versionné' });
    continue;
  }

  let content;
  try {
    content = fs.readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }

  if (privateKey.test(content)) {
    findings.push({ file, reason: 'Clé privée détectée' });
  }

  if (awsKey.test(content)) {
    findings.push({ file, reason: 'Clé AWS potentielle détectée' });
  }

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = line.trim().match(envSecret);

    if (!match) {
      continue;
    }

    const value = match[2].trim().replace(/^['"]|['"]$/g, '');

    if (allowedValues.includes(value) || value.startsWith('${{')) {
      continue;
    }

    findings.push({
      file,
      line: index + 1,
      reason: `Valeur de secret potentielle pour ${match[1]}`,
    });
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      event: findings.length === 0 ? 'secrets.audit.passed' : 'secrets.audit.failed',
      filesScanned: files.length,
      findings,
      timestamp: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

if (findings.length > 0) {
  process.exit(1);
}
