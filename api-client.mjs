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
 *   BRIDGE_URL      - Bridge WebSocket 地址（默认从 APP_PUBLISH_ADDRESS 拼接 /connect）
 *   BRIDGE_TOKEN    - Bridge 连接 token
 *   BRIDGE_ID       - 客户端标识 (默认: local-1)
 *   ANTHROPIC_BASE_URL - Anthropic API 地址
 *   ANTHROPIC_API_KEY  - Anthropic API Key
 *   OPENAI_BASE_URL    - OpenAI 兼容 API 地址（降级备选）
 *   OPENAI_API_KEY     - OpenAI 兼容 API Key（降级备选）
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
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL) || 25000;
const RECONNECT_MAX_DELAY = Number(process.env.RECONNECT_MAX_DELAY) || 30000;

if (!ANTHROPIC_BASE_URL || !ANTHROPIC_API_KEY) {
  if (!OPENAI_BASE_URL || !OPENAI_API_KEY) {
    console.error("必须设置 ANTHROPIC_BASE_URL+ANTHROPIC_API_KEY 或 OPENAI_BASE_URL+OPENAI_API_KEY（至少一组）");
    process.exit(1);
  }
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

    if (!msg.requestId) {
      return;
    }

    const rid = msg.requestId.slice(0, 8);
    const path = msg.path || "/v1/messages";
    const method = msg.method || "POST";
    const isStream = msg.stream === true;

    log(`收到请求 ${rid}... ${method} ${path} (stream=${isStream})`);

    // 为这个请求创建 AbortController
    const controller = new AbortController();
    activeControllers.set(msg.requestId, controller);

    try {
      if (path === "/v1/messages") {
        // Anthropic Messages: 先 Anthropic 后降级 OpenAI（含格式转换）
        if (isStream) {
          await forwardStreamWithFallback(msg.requestId, msg.body, controller);
        } else {
          const response = await forwardWithFallback(msg.body, controller);
          safeSend({ requestId: msg.requestId, response });
        }
      } else if (path === "/v1/models") {
        // 透传到 OpenAI /v1/models
        const response = await forwardToOpenAIPassthrough("/v1/models", "GET", null, controller);
        safeSend({ requestId: msg.requestId, response });
      } else if (path === "/v1/chat/completions") {
        // 直接透传到 OpenAI /v1/chat/completions
        if (isStream) {
          await forwardToOpenAIPassthroughStream(msg.requestId, "/v1/chat/completions", msg.body, controller);
        } else {
          const response = await forwardToOpenAIPassthrough("/v1/chat/completions", "POST", msg.body, controller);
          safeSend({ requestId: msg.requestId, response });
        }
      } else if (path === "/v1/responses") {
        // 直接透传到 OpenAI /v1/responses
        if (isStream) {
          await forwardToOpenAIPassthroughStream(msg.requestId, "/v1/responses", msg.body, controller);
        } else {
          const response = await forwardToOpenAIPassthrough("/v1/responses", "POST", msg.body, controller);
          safeSend({ requestId: msg.requestId, response });
        }
      } else {
        throw new Error(`未知的路径: ${path}`);
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

// ── Anthropic Messages ↔ OpenAI Chat 格式转换 ──────────────────────────

/** Anthropic messages 请求 → OpenAI chat completions 请求 */
function anthropicToOpenAIRequest(parsed) {
  const messages = [];

  // system → OpenAI system message
  if (parsed.system) {
    const systemText = Array.isArray(parsed.system)
      ? parsed.system
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
      : parsed.system;
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // messages 转换
  for (const msg of parsed.messages || []) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // content blocks → 提取文本（图片等暂不支持）
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) {
        messages.push({ role: msg.role, content: text });
      }
    }
  }

  const result = {
    model: parsed.model || "gpt-4o",
    messages,
    stream: parsed.stream ?? false,
  };

  if (parsed.max_tokens) result.max_tokens = parsed.max_tokens;
  if (parsed.temperature != null) result.temperature = parsed.temperature;
  if (parsed.top_p != null) result.top_p = parsed.top_p;
  if (parsed.stop_sequences) result.stop = parsed.stop_sequences;

  return result;
}

/** OpenAI chat completions 非流式响应 → Anthropic messages 响应 */
function openAIToAnthropicResponse(data) {
  const choice = data.choices?.[0];
  const content = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  return {
    id: data.id || `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    content,
    model: data.model || "unknown",
    stop_reason: choice?.finish_reason === "stop" ? "end_turn"
      : choice?.finish_reason === "length" ? "max_tokens"
      : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

/** 非流式转发 → OpenAI（降级） */
async function forwardToOpenAI(body, controller) {
  let parsed = typeof body === "string" ? JSON.parse(body) : body;
  const openAIBody = anthropicToOpenAIRequest({ ...parsed, stream: false });
  const apiUrl = `${OPENAI_BASE_URL}/v1/chat/completions`;

  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openAIBody),
      signal: controller.signal,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`OpenAI API ${res.status}: ${JSON.stringify(data)}`);
    }
    return openAIToAnthropicResponse(data);
  } finally {
    clearTimeout(timeout);
  }
}

/** 流式转发 → OpenAI（降级），将 OpenAI SSE 转为 Anthropic SSE 格式 */
async function forwardToOpenAIStream(requestId, body, controller) {
  let parsed = typeof body === "string" ? JSON.parse(body) : body;
  const openAIBody = anthropicToOpenAIRequest({ ...parsed, stream: true });
  // 请求 stream_options 以获取 usage
  openAIBody.stream_options = { include_usage: true };
  const apiUrl = `${OPENAI_BASE_URL}/v1/chat/completions`;

  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openAIBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${errorText}`);
    }

    const msgId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const model = parsed.model || "unknown";

    // 发送 Anthropic 格式的 message_start
    const startEvent =
      `event: message_start\n` +
      `data: ${JSON.stringify({
        type: "message_start",
        message: {
          id: msgId, type: "message", role: "assistant",
          content: [], model, stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}\n\n`;
    safeSend({ requestId, type: "stream_chunk", chunk: startEvent });

    // content_block_start
    const blockStart =
      `event: content_block_start\n` +
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })}\n\n`;
    safeSend({ requestId, type: "stream_chunk", chunk: blockStart });

    // 读取 OpenAI SSE 流并转换
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalUsage = null;
    let stopReason = "end_turn";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (controller.signal.aborted) { reader.cancel(); break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;

        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        // 提取 usage（最后一个 chunk）
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }

        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;

        if (finishReason) {
          stopReason = finishReason === "stop" ? "end_turn"
            : finishReason === "length" ? "max_tokens"
            : "end_turn";
        }

        if (delta?.content) {
          const deltaEvent =
            `event: content_block_delta\n` +
            `data: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: delta.content },
            })}\n\n`;
          if (!safeSend({ requestId, type: "stream_chunk", chunk: deltaEvent })) {
            controller.abort();
            reader.cancel();
            throw new Error("WebSocket disconnected during streaming");
          }
        }
      }
    }

    if (!controller.signal.aborted) {
      // content_block_stop
      const blockStop =
        `event: content_block_stop\n` +
        `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`;
      safeSend({ requestId, type: "stream_chunk", chunk: blockStop });

      // message_delta (stop_reason + usage)
      const msgDelta =
        `event: message_delta\n` +
        `data: ${JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: finalUsage?.completion_tokens || 0 },
        })}\n\n`;
      safeSend({ requestId, type: "stream_chunk", chunk: msgDelta });

      // message_stop
      const msgStop =
        `event: message_stop\n` +
        `data: ${JSON.stringify({ type: "message_stop" })}\n\n`;
      safeSend({ requestId, type: "stream_chunk", chunk: msgStop });

      safeSend({ requestId, type: "stream_end" });
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── 降级调度 ─────────────────────────────────────────────────────────────

const hasAnthropic = !!(ANTHROPIC_BASE_URL && ANTHROPIC_API_KEY);
const hasOpenAI = !!(OPENAI_BASE_URL && OPENAI_API_KEY);

/** 非流式：先 Anthropic，失败降级 OpenAI */
async function forwardWithFallback(body, controller) {
  if (hasAnthropic) {
    try {
      return await forwardToAnthropic(body, controller);
    } catch (err) {
      if (controller.signal.aborted) throw err;
      if (hasOpenAI) {
        log(`Anthropic 失败 (${err.message})，降级到 OpenAI`);
      } else {
        throw err;
      }
    }
  }
  if (hasOpenAI) {
    return await forwardToOpenAI(body, controller);
  }
  throw new Error("无可用的上游 API");
}

/** 流式：先 Anthropic，失败降级 OpenAI */
async function forwardStreamWithFallback(requestId, body, controller) {
  if (hasAnthropic) {
    try {
      return await forwardToAnthropicStream(requestId, body, controller);
    } catch (err) {
      if (controller.signal.aborted) throw err;
      if (hasOpenAI) {
        log(`Anthropic 流式失败 (${err.message})，降级到 OpenAI`);
      } else {
        throw err;
      }
    }
  }
  if (hasOpenAI) {
    return await forwardToOpenAIStream(requestId, body, controller);
  }
  throw new Error("无可用的上游 API");
}

// ── OpenAI 直接透传（/v1/models, /v1/chat/completions, /v1/responses）────

/** 非流式透传到 OpenAI，原样返回响应 */
async function forwardToOpenAIPassthrough(path, method, body, controller) {
  if (!hasOpenAI) throw new Error("OPENAI_BASE_URL/OPENAI_API_KEY 未配置");

  const apiUrl = `${OPENAI_BASE_URL}${path}`;
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
    };
    if (body && method !== "GET") {
      options.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const res = await fetch(apiUrl, options);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`OpenAI API ${res.status}: ${JSON.stringify(data)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** 流式透传到 OpenAI，原样转发 SSE 块 */
async function forwardToOpenAIPassthroughStream(requestId, path, body, controller) {
  if (!hasOpenAI) throw new Error("OPENAI_BASE_URL/OPENAI_API_KEY 未配置");

  let parsed = typeof body === "string" ? JSON.parse(body) : body;
  parsed.stream = true;
  const apiUrl = `${OPENAI_BASE_URL}${path}`;

  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(parsed),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${errorText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (controller.signal.aborted) { reader.cancel(); break; }

      const chunk = decoder.decode(value, { stream: true });
      if (!safeSend({ requestId, type: "stream_chunk", chunk })) {
        controller.abort();
        reader.cancel();
        throw new Error("WebSocket disconnected during streaming");
      }
    }

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
log(`  Anthropic: ${ANTHROPIC_BASE_URL || "(未配置)"}`);
log(`  OpenAI:    ${OPENAI_BASE_URL || "(未配置)"}`);
log(`  日志目录:  ${LOG_DIR}`);
log(`  Node版本:  ${process.version}`);
connect();
