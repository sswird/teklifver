// dist-pages klasörünü gh-pages dalına yükler: npm run pages:deploy
// Dal yalnızca üretilmiş dosyaları tutar ve her yüklemede baştan yazılır; main dalına dokunulmaz.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-pages');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

// Yarıda kalmış bir derleme yayınlanmasın: filtrelerin verisi ve 404 sayfası en son yazılır.
const required = ['index.html', '404.html', path.join('data', 'site.json')];
const missing = required.filter(file => !fs.existsSync(path.join(OUT, file)));
if (missing.length) {
  console.error(`Derleme eksik (${missing.join(', ')}). Önce çıktıyı yeniden üretin: npm run pages:build`);
  process.exit(1);
}

const remote = git(['remote', 'get-url', 'origin'], ROOT);
const name = git(['config', 'user.name'], ROOT);
const email = git(['config', 'user.email'], ROOT);

fs.rmSync(path.join(OUT, '.git'), { recursive: true, force: true });
git(['init', '-q', '-b', 'gh-pages'], OUT);
git(['add', '-A'], OUT);
git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', 'Statik önizlemeyi güncelle'], OUT);
execFileSync('git', ['push', '--force', remote, 'gh-pages'], { cwd: OUT, stdio: 'inherit' });
fs.rmSync(path.join(OUT, '.git'), { recursive: true, force: true });
console.log('  gh-pages dalı güncellendi.');
