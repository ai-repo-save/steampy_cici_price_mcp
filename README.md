# steampy_cici_price_mcp

把你提供的 Userscript 逻辑封装为一个 MCP Server，可在任意支持 MCP 的客户端中查询：

- SteamPY：CDKey / 余额购 / 代购价格
- STEAMCICI：CDKey 价格与上架时间（距今天数）

## 安装

```bash
npm install
```

## 启动（stdio）

```bash
npm start
```

## 可用工具

### 1) `get_steampy_price`

查询 SteamPY 价格。

输入参数：

- `appId` (string | number): Steam App ID
- `subId` (string | number): subid 或 bundleid
- `type` ("subid" | "bundleid", 可选，默认 "subid")

### 2) `get_cici_price`

查询 STEAMCICI 价格。

输入参数：

- `appId` (string | number): Steam App ID（作为 parentId）
- `subId` (string | number): 用于在返回列表中匹配 `gameId`
- `type` ("subid" | "bundleid", 可选，保留字段)

### 3) `get_game_prices`

同时查询 SteamPY 与 STEAMCICI，并额外返回 `cheapest`（最低价来源与数值）。

输入参数同上。

## MCP 客户端配置示例（Cursor / Claude Desktop 类似）

```json
{
  "mcpServers": {
    "steampy-cici-price": {
      "command": "node",
      "args": ["/absolute/path/to/repo/src/index.js"]
    }
  }
}
```

## 返回说明

- 所有工具都会返回：
  - `content`: 文本化 JSON
  - `structuredContent`: 结构化 JSON（便于模型直接解析）
- 网络错误、超时、接口异常时会返回 `ok: false` 及错误信息，不会直接崩溃。