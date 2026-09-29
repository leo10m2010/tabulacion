const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'tutorica-chrome-extension');
const outputDirectory = path.join(root, 'dist');
const packageJson = readJson(path.join(root, 'package.json'));
const manifest = readJson(path.join(source, 'manifest.json'));
const fixedDate = new Date('2020-01-01T00:00:00.000Z');
const allowedTopLevel = new Set([
  'manifest.json',
  'icons',
  'background',
  'content',
  'popup',
  'LICENSE',
]);

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`
  );
}

const requiredEntries = [
  'manifest.json',
  'LICENSE',
  'icons',
  'background',
  'content',
  'popup',
];
for (const entry of requiredEntries) {
  if (!fs.existsSync(path.join(source, entry))) {
    throw new Error(`Missing extension source entry: ${entry}`);
  }
}

async function build() {
  const zip = new JSZip();
  for (const entry of requiredEntries) {
    const absolute = path.join(source, entry);
    if (fs.statSync(absolute).isDirectory()) {
      addDirectory(zip, absolute, entry);
    } else {
      addFile(zip, absolute, entry);
    }
  }

  // Las fuentes son runtime assets del popup. Dentro del artefacto se ubican
  // bajo popup/fonts para mantener el ZIP limitado a los roots publicados.
  const fontsDirectory = path.join(source, 'fonts');
  if (fs.existsSync(fontsDirectory)) {
    addDirectory(zip, fontsDirectory, 'popup/fonts');
    const cssPath = 'popup/popup.css';
    const css = zip.file(cssPath)?.async
      ? await zip.file(cssPath).async('string')
      : '';
    zip.file(cssPath, css.replaceAll('../fonts/', './fonts/'), {
      date: fixedDate,
      createFolders: false,
    });
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
  });

  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(
    outputDirectory,
    `tesishub-forms-extension-${manifest.version}.zip`
  );
  fs.writeFileSync(output, buffer);
  await verify(output);
  process.stdout.write(`${output}\n`);
}

function addDirectory(zip, absoluteDirectory, zipDirectory) {
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(absoluteDirectory, entry.name);
    const relative = `${zipDirectory}/${entry.name}`.replaceAll('\\', '/');
    if (entry.isDirectory()) {
      addDirectory(zip, absolute, relative);
    } else if (entry.isFile()) {
      addFile(zip, absolute, relative);
    }
  }
}

function addFile(zip, absolute, relative) {
  zip.file(relative.replaceAll('\\', '/'), fs.readFileSync(absolute), {
    date: fixedDate,
    createFolders: false,
  });
}

async function verify(output) {
  const generated = await JSZip.loadAsync(fs.readFileSync(output));
  const names = Object.keys(generated.files).filter((name) => !generated.files[name].dir);
  for (const name of names) {
    const topLevel = name.split('/')[0];
    if (!allowedTopLevel.has(topLevel)) {
      throw new Error(`Unexpected ZIP entry: ${name}`);
    }
  }

  const zippedManifest = JSON.parse(
    await generated.file('manifest.json').async('string')
  );
  if (zippedManifest.version !== packageJson.version) {
    throw new Error('Generated ZIP has an unexpected manifest version');
  }
  for (const expected of [
    'manifest.json',
    'LICENSE',
    'background/background.js',
    'content/content.js',
    'content/content.css',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css',
  ]) {
    if (!generated.file(expected)) {
      throw new Error(`Generated ZIP is missing ${expected}`);
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

build().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
