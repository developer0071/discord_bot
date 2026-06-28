const fs = require('fs');
let code = fs.readFileSync('src/utils/firebase.js', 'utf8');

code = code.replace('const db = admin.firestore();',
`const { getFirestore } = require('firebase-admin/firestore');
const dbs = {
  moonlight: getFirestore(),
  sunshine: getFirestore(admin.app(), 'sunshine')
};
const getDb = (r = 'moonlight') => dbs[r] || dbs.moonlight;`);

code = code.replace(/async function ([a-zA-Z0-9_]+)\((.*?)\)\s*\{/g, (match, fnName, args) => {
  if (['saveUserProfile', 'getUserProfile', 'getAllUsers'].includes(fnName)) {
    return match + `\n  const db = getDb('moonlight');`;
  }
  
  if (args.trim() === '') {
    return `async function ${fnName}(regiment = 'moonlight') {\n  const db = getDb(regiment);`;
  } else {
    return `async function ${fnName}(${args}, regiment = 'moonlight') {\n  const db = getDb(regiment);`;
  }
});

code = code.replace('getDb: () => db,', 'getDb,');

fs.writeFileSync('src/utils/firebase.js', code);
console.log('done');
