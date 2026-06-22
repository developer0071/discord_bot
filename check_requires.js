const fs = require('fs');
const path = require('path');

function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory() && file !== 'node_modules') {
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

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const reqPath = match[1];
    // We only care about relative paths for this check
    if (reqPath.startsWith('.')) {
      const dir = path.dirname(file);
      const resolved = path.resolve(dir, reqPath);
      // It could be a file with or without .js, or a directory with index.js
      if (!fs.existsSync(resolved) && 
          !fs.existsSync(resolved + '.js') && 
          !fs.existsSync(path.join(resolved, 'index.js')) && 
          !fs.existsSync(resolved + '.json')) {
        console.error(`Broken require in ${file}: require('${reqPath}')`);
        hasErrors = true;
      }
    }
  }
}

if (!hasErrors) {
  console.log('No broken relative requires found.');
}
