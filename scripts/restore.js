require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const sourceDatabase = process.env.POSTGRES_DATABASE || 'gymsoins';
const targetDatabase = process.env.RESTORE_DATABASE;
const backupDir =
  process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const dockerContainer = process.env.BACKUP_DOCKER_CONTAINER;
const allowOverPrimary = process.env.ALLOW_RESTORE_OVER_PRIMARY === 'true';
const dropExisting = process.env.RESTORE_DROP_EXISTING === 'true';
const cleanRestore = process.env.RESTORE_CLEAN === 'true';

const database = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USERNAME || 'admin',
  password: process.env.POSTGRES_PASSWORD || '',
};

function latestBackup() {
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Dossier de sauvegarde introuvable : ${backupDir}`);
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.endsWith('.dump'))
    .map((file) => path.join(backupDir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (files.length === 0) {
    throw new Error('Aucune sauvegarde .dump disponible.');
  }

  return files[0];
}

function verifyChecksum(file) {
  const checksumFile = `${file}.sha256`;

  if (!fs.existsSync(checksumFile)) {
    return null;
  }

  const expected = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0];
  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');

  if (expected !== actual) {
    throw new Error('Checksum de sauvegarde invalide.');
  }

  return actual;
}

function safeIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Nom de base invalide : ${value}`);
  }
  return value;
}

async function ensureDatabase() {
  const admin = new Client({
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: 'postgres',
  });

  await admin.connect();

  try {
    if (dropExisting) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [targetDatabase],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${targetDatabase}"`);
    }

    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDatabase],
    );

    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${targetDatabase}"`);
    }
  } finally {
    await admin.end();
  }
}

function restore(file) {
  return new Promise((resolve, reject) => {
    const command = dockerContainer ? 'docker' : 'pg_restore';
    const args = dockerContainer
      ? [
          'exec',
          '-i',
          '-e',
          `PGPASSWORD=${database.password}`,
          dockerContainer,
          'pg_restore',
          '--no-owner',
          '--no-privileges',
          ...(cleanRestore ? ['--clean', '--if-exists'] : []),
          '-U',
          database.user,
          '-d',
          targetDatabase,
        ]
      : [
          '--no-owner',
          '--no-privileges',
          ...(cleanRestore ? ['--clean', '--if-exists'] : []),
          '-h',
          database.host,
          '-p',
          String(database.port),
          '-U',
          database.user,
          '-d',
          targetDatabase,
        ];

    const child = spawn(command, args, {
      env: { ...process.env, PGPASSWORD: database.password },
    });
    const input = fs.createReadStream(file);
    let stderr = '';

    input.pipe(child.stdin);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    input.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `pg_restore a échoué (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

async function main() {
  if (!targetDatabase) {
    throw new Error('RESTORE_DATABASE est obligatoire.');
  }

  safeIdentifier(targetDatabase);

  if (targetDatabase === sourceDatabase && !allowOverPrimary) {
    throw new Error(
      'Restauration refusée sur la base source. Définir ALLOW_RESTORE_OVER_PRIMARY=true pour forcer.',
    );
  }

  const file = process.env.BACKUP_FILE
    ? path.resolve(process.env.BACKUP_FILE)
    : latestBackup();

  if (!fs.existsSync(file)) {
    throw new Error(`Sauvegarde introuvable : ${file}`);
  }

  const checksum = verifyChecksum(file);
  await ensureDatabase();
  await restore(file);

  process.stdout.write(
    `${JSON.stringify({
      event: 'restore.completed',
      sourceDatabase,
      targetDatabase,
      file,
      checksum,
      cleanRestore,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'restore.failed',
      targetDatabase,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exit(1);
});
