#!/bin/bash
# 启动 API Client（已运行则跳过）
export PATH="/home/claude/.bun/bin:$PATH"
cd "$(dirname "$0")"

if pm2 list 2>/dev/null | grep -q "api-client.*online"; then
  echo "api-client 已在运行，跳过"
  exit 0
fi

pm2 delete api-client 2>/dev/null || true
pm2 start api-client.mjs --name api-client --interpreter node
pm2 save
echo "api-client 已启动"
