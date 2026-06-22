const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

try {
  // Read the root index.html
  let html = fs.readFileSync('index.html', 'utf-8');
  
  // Vercel builds from the dashboard directory, so paths must be relative to dashboard
  let modified = html.replace('/dashboard/src/main.jsx', '/src/main.jsx');
  
  // Temporarily write to dashboard/index.html
  fs.writeFileSync(path.join('dashboard', 'index.html'), modified);
  console.log('✅ Temporarily copied index.html to dashboard/ for Vercel deployment.');
  
  // Create dashboard/public directory to copy static assets
  const publicDir = path.join('dashboard', 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
  }
  
  // Copy logo.png
  if (fs.existsSync('logo.png')) {
    fs.copyFileSync('logo.png', path.join(publicDir, 'logo.png'));
    console.log('✅ Copied logo.png to dashboard/public/');
  }
  
  // Copy family folder
  if (fs.existsSync('family')) {
    execSync('xcopy /E /I /Y family dashboard\\public\\family', { stdio: 'inherit' });
    console.log('✅ Copied family/ folder to dashboard/public/');
  }
  
  // Run vercel deploy
  console.log('🚀 Running Vercel deployment...');
  execSync('cd dashboard && vercel --prod', { stdio: 'inherit' });
  
} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
} finally {
  // Clean up
  try {
    if (fs.existsSync(path.join('dashboard', 'index.html'))) {
      fs.unlinkSync(path.join('dashboard', 'index.html'));
      console.log('🧹 Cleaned up temporary dashboard/index.html');
    }
    const publicDir = path.join('dashboard', 'public');
    if (fs.existsSync(publicDir)) {
      fs.rmSync(publicDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up temporary dashboard/public/');
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}
