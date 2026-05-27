# Pre-IPO Spread Dashboard

本项目是一个只读的盘前合约价差对冲分析仪表盘，用于比较 OKX、Binance、Ventuals、TradeXYZ 的 SPACEX / OPENAI / ANTHROPIC 合约价格、资金费、手续费、滑点和红线收益。

## 本地开发

```bash
npm install
npm run dev
```

前端地址：

```text
http://127.0.0.1:8848
```

## 容器部署

```bash
docker compose up -d --build
```

访问：

```text
http://服务器IP:8848
```

也可以直接使用 Docker：

```bash
docker build -t ipo-dashboard .
docker run -d --name ipo-dashboard --restart unless-stopped -p 8848:8848 ipo-dashboard
```

## 运行说明

- 容器内 Express 会同时提供 `/api` 和前端静态页面。
- 容器 `PORT` 默认是 `8848`。
- `HOST` 默认容器部署使用 `0.0.0.0`。
- 本工具只读分析，不保存 API Key，不下单。
