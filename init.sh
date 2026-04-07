#!/bin/bash
# ============================================
# camelAI 容器初始化脚本
# 用途：首次部署或容器重建后执行，配置自启动环境
# 执行方式：bash /home/claude/account-admin/init.sh
# ============================================

set -e

AUTOSTART_DIR="/home/claude/.claude"
BASHRC_FILE="/home/claude/.bashrc"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export PATH="/home/claude/.bun/bin:$PATH"

echo "========== 1. 创建自启动脚本 =========="

mkdir -p "$AUTOSTART_DIR"
cp "$SCRIPT_DIR/autostart.sh.template" "$AUTOSTART_DIR/autostart.sh" 2>/dev/null || {
  # autostart.sh 已由项目管理，跳过
  echo "  -> $AUTOSTART_DIR/autostart.sh 已存在"
}
chmod +x "$AUTOSTART_DIR/autostart.sh"

echo "========== 2. 配置 .bashrc 自启动钩子 =========="

if ! grep -q "autostart.sh" "$BASHRC_FILE" 2>/dev/null; then
  echo '' >> "$BASHRC_FILE"
  echo '# 容器启动时自动恢复服务' >> "$BASHRC_FILE"
  echo '[ -f ~/.claude/autostart.sh ] && bash ~/.claude/autostart.sh &>/dev/null &' >> "$BASHRC_FILE"
  echo "  -> 已写入 $BASHRC_FILE"
else
  echo "  -> $BASHRC_FILE 已包含自启动配置，跳过"
fi

echo "========== 3. 配置 Claude Code SessionStart Hook =========="

SETTINGS_FILE="/home/claude/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"

if [ -f "$SETTINGS_FILE" ] && jq -e '.hooks.SessionStart' "$SETTINGS_FILE" &>/dev/null; then
  echo "  -> SessionStart hook 已存在，跳过"
else
  # 如果文件存在则合并，否则新建
  if [ -f "$SETTINGS_FILE" ]; then
    jq '.hooks.SessionStart = [{"hooks":[{"type":"command","command":"bash /home/claude/account-admin/start.sh 2>/dev/null || true","timeout":30,"statusMessage":"正在检查 api-client..."}]}]' \
      "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
  else
    cat > "$SETTINGS_FILE" <<'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /home/claude/account-admin/start.sh 2>/dev/null || true",
            "timeout": 30,
            "statusMessage": "正在检查 api-client..."
          }
        ]
      }
    ]
  }
}
EOF
  fi
  echo "  -> 已写入 $SETTINGS_FILE"
fi

echo "========== 4. 启动 api-client =========="

bash "$SCRIPT_DIR/start.sh"

echo "========== 5. 验证 =========="

sleep 2
pm2 status

echo ""
echo "初始化完成！"
