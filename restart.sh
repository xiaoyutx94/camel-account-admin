#!/bin/bash
# 重启 API Client
export PATH="/home/claude/.bun/bin:$PATH"
pm2 restart api-client
echo "api-client 已重启"
