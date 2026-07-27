#!/usr/bin/env bash
# Deploy trên EC2: kéo code mới, build, chạy migration, reload PM2 không downtime.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/aws-deployment-api}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-aws-deployment-api}"

cd "$APP_DIR"

echo "==> Pull $BRANCH"
git fetch --prune origin
git reset --hard "origin/$BRANCH"

echo "==> Install dependencies"
npm ci

echo "==> Build"
npm run build

echo "==> Run migrations"
npm run migration:run

echo "==> Reload PM2"
if pm2 describe "$PM2_APP" > /dev/null 2>&1; then
  pm2 reload "$PM2_APP" --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo "==> Health check"
for _ in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null; then
    echo "Deploy thành công"
    exit 0
  fi
  sleep 2
done

echo "Health check thất bại — kiểm tra: pm2 logs $PM2_APP" >&2
exit 1
