const fs = require('fs');
const path = require('path');

let baseDir = null;

function root() {
  if (!baseDir) {
    let userData = process.env.TFT_ASISTAN_DATA;
    if (!userData) {
      try {
        userData = require('electron').app.getPath('userData');
      } catch {
        userData = path.join(process.cwd(), '.data');
      }
    }
    baseDir = path.join(userData, 'cache');
  }
  return baseDir;
}

/** Uygulama veri klasörü altında (yoksa oluşturarak) bir klasör yolu döndürür. */
function dataDir(...parts) {
  const dir = path.join(path.dirname(root()), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(name, sub) {
  const dir = path.join(root(), ...sub);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(name).replace(/[^\w.-]/g, '_')}.json`);
}

/** Önbellekten okur. `fresh`, dosyanın maxAgeMs süresinden yeni olup olmadığını söyler. */
function read(name, maxAgeMs = Infinity, sub = []) {
  try {
    const file = fileFor(name, sub);
    const stat = fs.statSync(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { data, fresh: Date.now() - stat.mtimeMs < maxAgeMs };
  } catch {
    return null;
  }
}

function write(name, data, sub = []) {
  fs.writeFileSync(fileFor(name, sub), JSON.stringify(data));
}

module.exports = { read, write, dataDir };
