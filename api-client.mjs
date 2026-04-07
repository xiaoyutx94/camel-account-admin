#!/usr/bin/env node

/**
 * API Client
 * 连接到远程 Bridge DO，接收 /v1/messages 请求并转发到 Anthropic API
 * 支持流式(SSE)和非流式响应
 *
 * 用法:
 *   node api-client.mjs
 *
 * 环境变量:
 *   BRIDGE_URL      - Bridge WebSocket 地址 (默认: wss://account-admin-36mzln.camelai.app/connect)
 *   BRIDGE_TOKEN    - Bridge 连接 token
 *   BRIDGE_ID       - 客户端标识 (默认: local-1)
 *   ANTHROPIC_BASE_URL - Anthropic API 地址
 *   ANTHROPIC_API_KEY  - Anthropic API Key
 *   HEARTBEAT_INTERVAL - 心跳间隔ms (默认: 25000)
 *   RECONNECT_MAX_DELAY - 最大重连延迟ms (默认: 30000)
 */

import { appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "logs");
const LOG_MAX_DAYS = 3;

// 确保日志目录存在
import { mkdirSync } from "node:fs";
try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10); // 2026-04-03
  return join(LOG_DIR, `api-client-${date}.log`);
}

function cleanOldLogs() {
  try {
    const cutoff = Date.now() - LOG_MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(LOG_DIR)) {
      const match = file.match(/^api-client-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match && new Date(match[1]).getTime() < cutoff) {
        unlinkSync(join(LOG_DIR, file));
      }
    }
  } catch {}
}

// 启动时清理旧日志
cleanOldLogs();

const BRIDGE_URL = process.env.BRIDGE_URL || `wss://${process.env.APP_PUBLISH_ADDRESS}/connect`;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "sk-7b6b0KtHVbDloF7RbKIjzmvSYhKyyB85FBcwW5ZuaZ8QfQWBqE0wx2EkEjue2zsy";
const BRIDGE_ID = process.env.BRIDGE_ID || "local-1";
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL) || 25000;
const RECONNECT_MAX_DELAY = Number(process.env.RECONNECT_MAX_DELAY) || 30000;

if (!ANTHROPIC_BASE_URL || !ANTHROPIC_API_KEY) {
  console.error("必须设置 ANTHROPIC_BASE_URL 和 ANTHROPIC_API_KEY");
  process.exit(1);
}

let ws = null;
let heartbeatTimer = null;
let reconnectDelay = 1000;
let reconnectTimer = null;
let isShuttingDown = false;

// 追踪所有进行中的请求，WS 断开时全部取消
const activeControllers = new Map(); // requestId -> AbortController

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(getLogFile(), line + "\n"); } catch {}
}

// 每天清理一次过期日志文件
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

function connect() {
  if (isShuttingDown) return;

  const url = `${BRIDGE_URL}?token=${encodeURIComponent(BRIDGE_TOKEN)}&id=${encodeURIComponent(BRIDGE_ID)}`;
  log(`连接中... ${BRIDGE_URL} (id=${BRIDGE_ID})`);
  log(`完整URL: ${url}`);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    log(`WebSocket 构造失败: ${err.message}\n${err.stack}`);
    scheduleReconnect();
    return;
  }

  log(`WebSocket 对象已创建, readyState=${ws.readyState}`);

  ws.addEventListener("open", () => {
    log("已连接到 Bridge, readyState=" + ws.readyState);
    reconnectDelay = 1000;

    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }
    }, HEARTBEAT_INTERVAL);
  });

  ws.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : event.data.toString();
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!msg.requestId || !msg.body) {
      return;
    }

    const rid = msg.requestId.slice(0, 8);
    const isStream = msg.stream === true;

    log(`收到请求 ${rid}... (stream=${isStream})`);

    // 为这个请求创建 AbortController
    const controller = new AbortController();
    activeControllers.set(msg.requestId, controller);

    try {
      if (isStream) {
        await forwardToAnthropicStream(msg.requestId, msg.body, controller);
      } else {
        const response = await forwardToAnthropic(msg.body, controller);
        safeSend({ requestId: msg.requestId, response });
      }
      log(`请求 ${rid}... 处理完成`);
    } catch (err) {
      if (controller.signal.aborted) {
        log(`请求 ${rid}... 已取消 (WS断开或关闭)`);
      } else if (isStream) {
        safeSend({
          requestId: msg.requestId,
          type: "stream_error",
          error: { type: "api_error", message: err.message },
        });
        log(`请求 ${rid}... 流式失败: ${err.message}`);
      } else {
        safeSend({
          requestId: msg.requestId,
          response: { type: "error", error: { type: "api_error", message: err.message } },
        });
        log(`请求 ${rid}... 失败: ${err.message}`);
      }
    } finally {
      activeControllers.delete(msg.requestId);
    }
  });

  ws.addEventListener("close", (event) => {
    log(`连接断开 (code=${event.code}, reason=${event.reason || "无"}, wasClean=${event.wasClean})`);
    cleanup();
    scheduleReconnect();
  });

  ws.addEventListener("error", (event) => {
    log(`WebSocket 错误: ${event.message || "无详细信息"}, type=${event.type}`);
    // 握手失败时可能只触发 error 不触发 close，需要主动重连
    if (ws && ws.readyState !== WebSocket.OPEN) {
      cleanup();
      scheduleReconnect();
    }
  });
}

/** 安全发送 WS 消息，连接断开时不抛错 */
function safeSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

/** 非流式转发 */
async function forwardToAnthropic(body, controller) {
  let parsed = typeof body === "string" ? JSON.parse(body) : body;
  parsed.stream = false;
  const requestBody = JSON.stringify(parsed);
  const apiUrl = `${ANTHROPIC_BASE_URL}/v1/messages`;

  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: requestBody,
      signal: controller.signal,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(data)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** 流式转发：读取 SSE 流，逐块通过 WS 发回 */
async function forwardToAnthropicStream(requestId, body, controller) {
  let parsed = typeof body === "string" ? JSON.parse(body) : body;
  parsed.stream = true;
  const requestBody = JSON.stringify(parsed);
  const apiUrl = `${ANTHROPIC_BASE_URL}/v1/messages`;

  const timeout = setTimeout(() => controller.abort(), 300000); // 5 分钟超时

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: requestBody,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errorText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 如果已被 abort，停止读取
      if (controller.signal.aborted) {
        reader.cancel();
        break;
      }

      const chunk = decoder.decode(value, { stream: true });

      if (!safeSend({ requestId, type: "stream_chunk", chunk })) {
        // WS 已断开，取消上游请求
        controller.abort();
        reader.cancel();
        throw new Error("WebSocket disconnected during streaming");
      }
    }

    // 流结束
    if (!controller.signal.aborted) {
      safeSend({ requestId, type: "stream_end" });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function cleanup() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;

  // 取消所有进行中的请求
  if (activeControllers.size > 0) {
    log(`取消 ${activeControllers.size} 个进行中的请求`);
    for (const [rid, controller] of activeControllers) {
      controller.abort();
    }
    activeControllers.clear();
  }

  ws = null;
}

function scheduleReconnect() {
  if (isShuttingDown) return;

  const jitter = Math.random() * 1000;
  const delay = Math.min(reconnectDelay + jitter, RECONNECT_MAX_DELAY);
  log(`${(delay / 1000).toFixed(1)}s 后重连...`);

  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
    connect();
  }, delay);
}

function shutdown(signal) {
  log(`收到 ${signal}，正在关闭...`);
  isShuttingDown = true;
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);

  // 取消所有进行中的请求
  for (const [, controller] of activeControllers) {
    controller.abort();
  }
  activeControllers.clear();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "Client shutting down");
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// 启动
log("=== API Client 启动 ===");
log(`  Bridge:    ${BRIDGE_URL}`);
log(`  Client ID: ${BRIDGE_ID}`);
log(`  日志目录:  ${LOG_DIR}`);
log(`  Node版本:  ${process.version}`);
connect();
