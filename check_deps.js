const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory() && file !== 'node_modules' && file !== 'dist' && !file.startsWith('.')) {
      walk(path.join(dir, file), fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(path.join(dir, file));
    }
  }
  return fileList;
}

const srcDir = path.join(__dirname, 'src');
const files = walk(srcDir);
const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

let hasErrors = false;
const deps = Object.keys(pkg.dependencies || {});
const builtins = require('module').builtinModules;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const reqPath = match[1];
    // We care about absolute/module paths here
    if (!reqPath.startsWith('.')) {
      const moduleName = reqPath.split('/')[0].startsWith('@') ? reqPath.split('/').slice(0, 2).join('/') : reqPath.split('/')[0];
      if (!deps.includes(moduleName) && !builtins.includes(moduleName)) {
        console.error(`Missing dependency in ${file}: require('${reqPath}') -> module ${moduleName}`);
        hasErrors = true;
      }
    }
  }
}

if (!hasErrors) {
  console.log('No missing dependencies found.');
}
