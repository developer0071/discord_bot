@echo off
echo [1/2] Launching Vercel production deployment...
start "Vercel Deploy" powershell -Command "npm run deploy:vercel:prod"

echo [2/2] Launching GitHub production deployment...
start "GitHub Deploy" powershell -Command "git add .; git commit -m 'fixed'; git push"

echo Task complete. All deployments are running in parallel and will close automatically upon completion.   
