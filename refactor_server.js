const fs = require('fs');

let code = fs.readFileSync('src/web/server.js', 'utf8');

// Add middleware
code = code.replace("app.use('/api', concurrencyGuard);", "app.use('/api', concurrencyGuard);\n  app.use('/api', (req, res, next) => {\n    req.regiment = req.headers['x-regiment'] || 'moonlight';\n    next();\n  });");

// Replace fb calls
code = code.replace(/fb\.getRegimentStatus\(\)/g, "fb.getRegimentStatus(req.regiment)");
code = code.replace(/fb\.getAllMembers\(\)/g, "fb.getAllMembers(req.regiment)");
code = code.replace(/fb\.getFullQueue\(\)/g, "fb.getFullQueue(req.regiment)");
code = code.replace(/fb\.getLogs\(50\)/g, "fb.getLogs(50, req.regiment)");
code = code.replace(/fb\.getDashboardSettings\(\)/g, "fb.getDashboardSettings(req.regiment)");

code = code.replace(/fb\.removeFromQueue\(([^,)]+)\)/g, "fb.removeFromQueue($1, req.regiment)");
code = code.replace(/fb\.addMember\(([^,]+),\s*([^)]+)\)/g, "fb.addMember($1, $2, req.regiment)");
code = code.replace(/fb\.removeMember\(([^)]+)\)/g, "fb.removeMember($1, req.regiment)");
code = code.replace(/fb\.isInQueue\(([^)]+)\)/g, "fb.isInQueue($1, req.regiment)");
code = code.replace(/fb\.isMember\(([^)]+)\)/g, "fb.isMember($1, req.regiment)");

code = code.replace(/assignRegimentRole\(([^)]+)\)/g, "assignRegimentRole($1, req.regiment)");
code = code.replace(/removeRegimentRole\(([^)]+)\)/g, "removeRegimentRole($1, req.regiment)");
code = code.replace(/promoteFromQueue\(([^)]+)\)/g, "promoteFromQueue($1, req.regiment)");

code = code.replace(/fb\.setMaxSlots\(([^)]+)\)/g, "fb.setMaxSlots($1, req.regiment)");
code = code.replace(/fb\.syncRegimentCount\(\)/g, "fb.syncRegimentCount(req.regiment)");

// Giveaways
code = code.replace(/fb\.getAllGiveaways\(\)/g, "fb.getAllGiveaways(req.regiment)");
code = code.replace(/fb\.isGiveawayEntrant\(([^,]+),\s*([^)]+)\)/g, "fb.isGiveawayEntrant($1, $2, req.regiment)");
code = code.replace(/fb\.getGiveaway\(([^)]+)\)/g, "fb.getGiveaway($1, req.regiment)");
code = code.replace(/fb\.addGiveawayEntrant\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g, "fb.addGiveawayEntrant($1, $2, $3, req.regiment)");
code = code.replace(/fb\.removeGiveawayEntrant\(([^,]+),\s*([^)]+)\)/g, "fb.removeGiveawayEntrant($1, $2, req.regiment)");
code = code.replace(/fb\.createGiveaway\(([^,]+),\s*([^)]+)\)/g, "fb.createGiveaway($1, $2, req.regiment)");
code = code.replace(/fb\.updateGiveaway\(([^,]+),\s*([^)]+)\)/g, "fb.updateGiveaway($1, $2, req.regiment)");

// Handle caching (if we cache by regiment)
code = code.replace(/let dataCache = null;/g, "let dataCache = { moonlight: null, sunshine: null };\n  let dataCacheTime = { moonlight: 0, sunshine: 0 };");
code = code.replace(/let dataCacheTime = 0;/g, "");

// In /api/data, use dataCache[req.regiment]
code = code.replace("if (!isReadOnly && dataCache && (now - dataCacheTime) < DATA_CACHE_TTL) {", "if (!isReadOnly && dataCache[req.regiment] && (now - dataCacheTime[req.regiment]) < DATA_CACHE_TTL) {");
code = code.replace("return res.json({ ...dataCache, tier: 'mod', canManageGiveaways: canGv });", "return res.json({ ...dataCache[req.regiment], tier: 'mod', canManageGiveaways: canGv });");
code = code.replace("dataCache = result;", "dataCache[req.regiment] = result;");
code = code.replace("dataCacheTime = now;", "dataCacheTime[req.regiment] = now;");

// Fix members sync logic, because REGIMENT_ROLE_ID is now per regiment
code = code.replace("const roleId = process.env.REGIMENT_ROLE_ID;", "const roleId = req.regiment === 'sunshine' ? process.env.SUNSHINE_ROLE_ID : process.env.REGIMENT_ROLE_ID;\n      if (!roleId) return res.status(500).json({ error: 'Role ID not configured for this regiment' });");

fs.writeFileSync('src/web/server.js', code);
console.log('Server refactored!');
