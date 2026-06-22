const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

let hasErrors = false;

for (const file of files) {
  try {
    execSync(`node -c "${file}"`, { stdio: 'pipe' });
  } catch (err) {
    console.error(`Syntax error in ${file}:\n${err.stderr.toString()}`);
    hasErrors = true;
  }
}

if (!hasErrors) {
  console.log('No syntax errors found.');
}
