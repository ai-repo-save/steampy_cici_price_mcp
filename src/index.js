#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const STEAMPY_BASE_URL = "https://steampy.com/";
const CICI_BASE_URL = "https://steamcici.com/";

const API_ENDPOINTS = {
  gameInfo: (subId, appId, type) =>
    `${STEAMPY_BASE_URL}xboot/common/plugIn/getGame?subId=${encodeURIComponent(
      subId,
    )}&appId=${encodeURIComponent(appId)}&type=${encodeURIComponent(type)}`,
  cdkDetail: (id) => `${STEAMPY_BASE_URL}cdkDetail?name=cn&gameId=${encodeURIComponent(id)}`,
  balanceBuyDetail: (id) =>
    `${STEAMPY_BASE_URL}balanceBuyDetail?data=cn&gameId=${encodeURIComponent(id)}`,
  hotGameDetail: (id) => `${STEAMPY_BASE_URL}hotGameDetail?gameId=${encodeURIComponent(id)}`,
  ciciGameList: (appId) =>
    `${CICI_BASE_URL}prod-api/user/system/shopGame/list?parentId=${encodeURIComponent(appId)}`,
};

const REQUEST_TIMEOUT_MS = 12000;
const STEAMCICI_INDEX_URL = "https://steamcici.com/index";

const stringOrNumber = z.union([z.string(), z.number()]);
const queryInputSchema = {
  appId: stringOrNumber.describe("Steam App ID，例如 570"),
  subId: stringOrNumber.describe("Steam subid 或 bundleid"),
  type: z
    .enum(["subid", "bundleid"])
    .default("subid")
    .describe('Steam 目标类型，默认 "subid"'),
};

function normalizeId(value) {
  return String(value).trim();
}

function calculateDaysAgo(dateString) {
  if (!dateString) {
    return null;
  }
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) {
    return null;
  }
  const diffMs = Date.now() - target.getTime();
  if (diffMs < 0) {
    return "未来";
  }
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return "今天";
  }
  if (diffDays === 1) {
    return "1天前";
  }
  return `${diffDays}天前`;
}

function toPriceString(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        ...headers,
      },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let data = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch {
        return {
          ok: false,
          error: "响应不是有效 JSON",
          status: response.status,
          rawText: bodyText.slice(0, 500),
        };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        data,
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error && typeof error === "object" && error.name === "AbortError"
          ? `请求超时（>${REQUEST_TIMEOUT_MS}ms）`
          : `网络错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function querySteamPyPrice({ appId, subId, type }) {
  const url = API_ENDPOINTS.gameInfo(subId, appId, type);
  const response = await fetchJson(url, {
    Referer: STEAMPY_BASE_URL,
    Origin: STEAMPY_BASE_URL,
  });

  if (!response.ok) {
    return {
      ok: false,
      source: "steampy",
      url,
      error: response.error,
      status: response.status ?? null,
      detail: response.data ?? null,
    };
  }

  const payload = response.data;
  if (!payload || payload.success !== true || !payload.result) {
    return {
      ok: false,
      source: "steampy",
      url,
      error: payload?.message ?? "SteamPY 返回异常",
      status: response.status,
      detail: payload ?? null,
    };
  }

  const { keyPrice, marketPrice, daiPrice, id } = payload.result;
  const gameId = id ? String(id) : null;

  return {
    ok: true,
    source: "steampy",
    url,
    status: response.status,
    appId,
    subId,
    type,
    prices: {
      cdkey: toPriceString(keyPrice),
      balanceBuy: toPriceString(marketPrice),
      daigou: toPriceString(daiPrice),
    },
    links: {
      cdkDetail: gameId ? API_ENDPOINTS.cdkDetail(gameId) : null,
      balanceBuyDetail: gameId ? API_ENDPOINTS.balanceBuyDetail(gameId) : null,
      hotGameDetail: gameId ? API_ENDPOINTS.hotGameDetail(gameId) : null,
    },
    raw: payload,
  };
}

async function queryCiciPrice({ appId, subId }) {
  const url = API_ENDPOINTS.ciciGameList(appId);
  const response = await fetchJson(url, {
    Referer: STEAMCICI_INDEX_URL,
    Origin: CICI_BASE_URL,
  });

  if (!response.ok) {
    return {
      ok: false,
      source: "steamcici",
      url,
      error: response.error,
      status: response.status ?? null,
      detail: response.data ?? null,
    };
  }

  const payload = response.data;
  if (!payload || payload.code !== 200 || !Array.isArray(payload.rows)) {
    return {
      ok: false,
      source: "steamcici",
      url,
      error: payload?.msg ?? "STEAMCICI 返回异常",
      status: response.status,
      detail: payload ?? null,
    };
  }

  const game = payload.rows.find((item) => normalizeId(item?.gameId ?? "") === subId) ?? null;
  if (!game) {
    return {
      ok: true,
      source: "steamcici",
      url,
      status: response.status,
      appId,
      subId,
      found: false,
      price: null,
      message: "未找到对应商品",
      link: STEAMCICI_INDEX_URL,
      raw: payload,
    };
  }

  const hangingTime = game.lastHangingTime ?? null;
  return {
    ok: true,
    source: "steamcici",
    url,
    status: response.status,
    appId,
    subId,
    found: true,
    price: toPriceString(game.lastLowSellPrice),
    link: STEAMCICI_INDEX_URL,
    lastHangingTime: hangingTime,
    lastHangingDaysAgo: calculateDaysAgo(hangingTime),
    raw: game,
  };
}

function toNumber(price) {
  if (price === null || price === undefined) {
    return null;
  }
  const parsed = Number(price);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeBestPrice(steampy, cici) {
  const candidates = [];
  if (steampy?.ok && steampy.prices) {
    candidates.push({ source: "steampy_cdkey", value: toNumber(steampy.prices.cdkey) });
    candidates.push({
      source: "steampy_balance_buy",
      value: toNumber(steampy.prices.balanceBuy),
    });
    candidates.push({ source: "steampy_daigou", value: toNumber(steampy.prices.daigou) });
  }
  if (cici?.ok && cici.found) {
    candidates.push({ source: "steamcici_cdkey", value: toNumber(cici.price) });
  }

  const valid = candidates.filter((item) => item.value !== null);
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((min, current) => (current.value < min.value ? current : min));
}

function asTextResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

const server = new McpServer({
  name: "steampy-cici-price-mcp",
  version: "1.0.0",
});

server.registerTool(
  "get_steampy_price",
  {
    description: "查询 SteamPY 价格（CDKey / 余额购 / 代购）",
    inputSchema: queryInputSchema,
  },
  async ({ appId, subId, type = "subid" }) => {
    const normalized = {
      appId: normalizeId(appId),
      subId: normalizeId(subId),
      type,
    };
    const result = await querySteamPyPrice(normalized);
    return asTextResult(result);
  },
);

server.registerTool(
  "get_cici_price",
  {
    description: "查询 STEAMCICI 的 CDKey 价格",
    inputSchema: queryInputSchema,
  },
  async ({ appId, subId }) => {
    const normalized = {
      appId: normalizeId(appId),
      subId: normalizeId(subId),
    };
    const result = await queryCiciPrice(normalized);
    return asTextResult(result);
  },
);

server.registerTool(
  "get_game_prices",
  {
    description: "一次性查询 SteamPY 与 STEAMCICI 价格，并返回最低价来源",
    inputSchema: queryInputSchema,
  },
  async ({ appId, subId, type = "subid" }) => {
    const normalized = {
      appId: normalizeId(appId),
      subId: normalizeId(subId),
      type,
    };

    const [steampy, cici] = await Promise.all([
      querySteamPyPrice(normalized),
      queryCiciPrice(normalized),
    ]);

    const combined = {
      ok: Boolean(steampy.ok || cici.ok),
      appId: normalized.appId,
      subId: normalized.subId,
      type: normalized.type,
      steampy,
      cici,
      cheapest: summarizeBestPrice(steampy, cici),
    };

    return asTextResult(combined);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("steampy-cici-price-mcp server started (stdio).");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
