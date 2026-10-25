/* eslint-disable no-console */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const archiveRoot = path.join(root, 'artifacts', 'phase5');

function usage() {
  console.error(
    'Usage: node scripts/archive-evidence.js --label <e2e|ui|sse|otel|load|backup|workers> --source <fichier> [--source <fichier> ...] [--note <texte>]',
  );
}

function parseArgs(argv) {
  const result = { label: '', note: '', sources: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--label') {
      result.label = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--source') {
      result.sources.push(argv[index + 1] || '');
      index += 1;
    } else if (arg === '--note') {
      result.note = argv[index + 1] || '';
      index += 1;
    } else {
      throw new Error(`Argument inconnu : ${arg}`);
    }
  }

  return result;
}

function assertArchiveable(source) {
  const basename = path.basename(source).toLowerCase();
  const forbidden = [
    '.env',
    'docker-compose.staging.yml',
    'id_rsa',
    'id_ed25519',
  ];

  if (forbidden.includes(basename) || basename.startsWith('.env.')) {
    throw new Error(`Fichier interdit dans l'archive : ${source}`);
  }

  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Source absente ou non fichier : ${source}`);
  }

  const size = fs.statSync(source).size;
  if (size > 10 * 1024 * 1024) {
    throw new Error(`Source trop volumineuse (>10 MiB) : ${source}`);
  }

  const content = fs.readFileSync(source, 'utf8');
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) ||
    /\b(PASSWORD|SECRET|TOKEN)\s*=\s*[^\s]+/i.test(content)
  ) {
    throw new Error(`Contenu potentiellement secret refusé : ${source}`);
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const { label, note, sources } = parseArgs(process.argv.slice(2));

  if (!/^[a-z0-9-]+$/.test(label)) {
    throw new Error('Label invalide (attendu : minuscules, chiffres, tirets).');
  }

  if (sources.length === 0) {
    usage();
    process.exit(1);
  }

  sources.forEach(assertArchiveable);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.join(archiveRoot, `${label}-${stamp}`);
  fs.mkdirSync(targetDir, { recursive: true });

  const files = sources.map((source) => {
    const basename = path.basename(source);
    const destination = path.join(targetDir, basename);
    fs.copyFileSync(source, destination);

    return {
      source,
      archive: path.relative(root, destination),
      bytes: fs.statSync(destination).size,
      sha256: sha256(destination),
    };
  });

  const manifest = {
    label,
    note,
    createdAt: new Date().toISOString(),
    files,
  };

  fs.writeFileSync(
    path.join(targetDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        event: 'evidence.archived',
        label,
        directory: path.relative(root, targetDir),
        files: files.map((file) => file.archive),
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
