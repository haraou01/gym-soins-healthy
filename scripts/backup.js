require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  validateReadonlyTarget,
  displayTarget,
} = require('./lib/db-target-policies');

const database = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USERNAME || 'admin',
  password: process.env.POSTGRES_PASSWORD || '',
  name: process.env.POSTGRES_DATABASE || 'gymsoins',
};

const backupDir =
  process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 7);
const dockerContainer = process.env.BACKUP_DOCKER_CONTAINER;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeMetrics(values) {
  const file = process.env.BACKUP_METRICS_FILE;
  if (!file) {
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    '# HELP gymsoins_backup_last_success_timestamp_seconds Dernier backup réussi',
    '# TYPE gymsoins_backup_last_success_timestamp_seconds gauge',
    ...Object.entries(values).map(([key, value]) => `${key} ${value}`),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o644 });
}

function runDump(file) {
  return new Promise((resolve, reject) => {
    const command = dockerContainer ? 'docker' : 'pg_dump';
    const args = dockerContainer
      ? [
          'exec',
          '-e',
          `PGPASSWORD=${database.password}`,
          dockerContainer,
          'pg_dump',
          '-Fc',
          '--no-owner',
          '--no-privileges',
          '-U',
          database.user,
          '-d',
          database.name,
        ]
      : [
          '-Fc',
          '--no-owner',
          '--no-privileges',
          '-h',
          database.host,
          '-p',
          String(database.port),
          '-U',
          database.user,
          '-d',
          database.name,
        ];

    const child = spawn(command, args, {
      env: { ...process.env, PGPASSWORD: database.password },
    });
    const output = fs.createWriteStream(file, { mode: 0o600 });
    let stderr = '';

    child.stdout.pipe(output);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    output.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `pg_dump a échoué (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

function pruneOldBackups(currentFile) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return 0;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of fs.readdirSync(backupDir)) {
    if (!entry.endsWith('.dump')) {
      continue;
    }

    const file = path.join(backupDir, entry);

    if (file === currentFile) {
      continue;
    }

    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.unlinkSync(file);
      const checksum = `${file}.sha256`;
      if (fs.existsSync(checksum)) {
        fs.unlinkSync(checksum);
      }
      removed += 1;
    }
  }

  return removed;
}

async function main() {
  // Une sauvegarde lit la base : refuser staging/55432 non autorisés avant
  // toute connexion ou écriture de fichier.
  const target = validateReadonlyTarget({
    host: database.host,
    port: database.port,
    database: database.name,
    env: process.env,
  });
  console.log(`[safe-target] cible ${displayTarget(target)}`);

  fs.mkdirSync(backupDir, { recursive: true });

  const safeDatabase = database.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = path.join(
    backupDir,
    `${safeDatabase}_${timestamp()}.dump`,
  );

  await runDump(file);

  const stats = fs.statSync(file);

  if (stats.size <= 0) {
    throw new Error('Le fichier de sauvegarde est vide.');
  }

  const checksum = sha256(file);
  fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`);

  const removed = pruneOldBackups(file);
  const completedAt = new Date();

  writeMetrics({
    gymsoins_backup_last_success_timestamp_seconds:
      completedAt.getTime() / 1_000,
    gymsoins_backup_last_size_bytes: stats.size,
    gymsoins_backup_last_retention_days: retentionDays,
  });

  process.stdout.write(
    `${JSON.stringify({
      event: 'backup.completed',
      database: database.name,
      file,
      sizeBytes: stats.size,
      sha256: checksum,
      retentionDays,
      oldBackupsRemoved: removed,
      timestamp: completedAt.toISOString(),
    })}\n`,
  );
}

main().catch((error) => {
  writeMetrics({
    gymsoins_backup_last_failure_timestamp_seconds: Date.now() / 1_000,
  });
  process.stderr.write(
    `${JSON.stringify({
      event: 'backup.failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exit(1);
});
