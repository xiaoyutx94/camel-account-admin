#!/bin/bash
# 停止 API Client
export PATH="/home/claude/.bun/bin:$PATH"
pm2 stop api-client
echo "api-client 已停止"
