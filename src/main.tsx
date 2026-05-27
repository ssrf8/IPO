import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Calculator, HelpCircle, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { calculateOpportunities, DEFAULT_PARAMS } from "../shared/calculations";
import { canonicalPrice } from "../shared/calculations";
import { TARGETS } from "../shared/markets.config";
import type { CalculationParams, DashboardResponse, MarketQuote, Opportunity, Target, Venue } from "../shared/types";
import "./styles.css";

const VENUES: Venue[] = ["OKX", "Binance", "Ventuals", "TradeXYZ"];

function fmt(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function bps(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} bps`;
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
}

function statusLabel(quote?: MarketQuote) {
  if (!quote) return "未配置";
  if (quote.status === "ok") return "正常";
  return quote.message ?? quote.status;
}

function displaySymbol(quote?: MarketQuote) {
  if (!quote) return "-";
  if (quote.venue === "Ventuals") return `${quote.target}-USDH`;
  return quote.symbol;
}

function quoteByTargetVenue(quotes: MarketQuote[]) {
  const map = new Map<string, MarketQuote>();
  quotes.forEach((quote) => map.set(`${quote.target}:${quote.venue}`, quote));
  return map;
}

function useQuotes() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/quotes");
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setData(await response.json() as DashboardResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "行情请求失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return { data, loading, error, reload: load };
}

function ParamPanel({ params, setParams }: { params: CalculationParams; setParams: (params: CalculationParams) => void }) {
  const patch = (next: Partial<CalculationParams>) => setParams({ ...params, ...next });
  const patchHaircut = (asset: string, value: number) => {
    setParams({
      ...params,
      stablecoinHaircutsBps: { ...params.stablecoinHaircutsBps, [asset]: value }
    });
  };

  return (
    <section className="control-panel">
      <div className="control-title">
        <span>计算参数</span>
        <div className="help">
          <button className="icon-button" type="button" aria-label="查看使用说明">
            <HelpCircle size={16} />
          </button>
          <div className="tooltip" role="tooltip">
            <strong>使用说明</strong>
            <p>工具会把同一标的不同交易所的价格先换成统一比较尺度，再枚举“低价做多、高价做空”的组合。</p>
            <p>SPACEX 目前有两种尺度：OKX/Ventuals 是估值除以 10 亿；Binance/TradeXYZ 的 SPCX 是份额价，先乘配置里的换算倍数后再比较。</p>
            <p>名义本金用于计算双腿手续费、资金费、滑点和预计盈亏，不代表真实下单金额。本工具只读分析，不会下单。</p>
            <p>交易手续费按配置里的 maker/taker 费率计算，开仓和平仓都会算；真实账户 VIP、返佣、平台币抵扣不会自动读取。</p>
            <p>资金费：Binance 会动态读取最新 funding 并小时化；OKX 有公开 funding 时读取，否则按配置 fallback；Ventuals/TradeXYZ 缺失时按 0 处理。</p>
            <p>滑点可用手动 bps，也可用订单簿 VWAP。订单簿深度不足时会回退到手动滑点，并在详情里提示。</p>
            <p>红线价差 = 总成本 / 对冲数量。当前可执行价差低于红线时，机会会标为低于红线。</p>
            <p>稳定币 haircut 用于给 USDT/USDC/USDH 的结算差异加成本，默认全部按 1:1 USD。</p>
          </div>
        </div>
      </div>
      <div className="toolbar">
        <label>
          名义本金
          <input type="number" min="100" step="100" value={params.notionalUsd} onChange={(e) => patch({ notionalUsd: Number(e.target.value) })} />
        </label>
        <label>
          持仓小时
          <input type="number" min="0" step="1" value={params.holdingHours} onChange={(e) => patch({ holdingHours: Number(e.target.value) })} />
        </label>
        <label>
          开仓费率
          <select value={params.feeModeOpen} onChange={(e) => patch({ feeModeOpen: e.target.value as CalculationParams["feeModeOpen"] })}>
            <option value="taker">Taker</option>
            <option value="maker">Maker</option>
          </select>
        </label>
        <label>
          平仓费率
          <select value={params.feeModeClose} onChange={(e) => patch({ feeModeClose: e.target.value as CalculationParams["feeModeClose"] })}>
            <option value="taker">Taker</option>
            <option value="maker">Maker</option>
          </select>
        </label>
        <label>
          滑点模式
          <select value={params.slippageMode} onChange={(e) => patch({ slippageMode: e.target.value as CalculationParams["slippageMode"] })}>
            <option value="manual">手动 bps</option>
            <option value="orderbook">订单簿 VWAP</option>
          </select>
        </label>
        <label>
          手动滑点 bps
          <input type="number" min="0" step="1" value={params.manualSlippageBps} onChange={(e) => patch({ manualSlippageBps: Number(e.target.value) })} />
        </label>
        <label>
          收敛价格
          <input type="number" min="0" step="0.1" placeholder="默认中点" value={params.closingPrice ?? ""} onChange={(e) => patch({ closingPrice: e.target.value === "" ? null : Number(e.target.value) })} />
        </label>
        {["USDT", "USDC", "USDH"].map((asset) => (
          <label key={asset}>
            {asset} haircut bps
            <input type="number" step="1" value={params.stablecoinHaircutsBps[asset] ?? 0} onChange={(e) => patchHaircut(asset, Number(e.target.value))} />
          </label>
        ))}
      </div>
    </section>
  );
}

function MarketMatrix({ quotes }: { quotes: MarketQuote[] }) {
  const byKey = useMemo(() => quoteByTargetVenue(quotes), [quotes]);
  return (
    <section className="panel">
      <div className="section-title">
        <TrendingUp size={18} />
        <h2>市场行情矩阵</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>标的</th>
              {VENUES.map((venue) => <th key={venue}>{venue}</th>)}
            </tr>
          </thead>
          <tbody>
            {TARGETS.map((target) => (
              <tr key={target}>
                <td className="target">{target}</td>
                {VENUES.map((venue) => {
                  const quote = byKey.get(`${target}:${venue}`);
                  return (
                    <td key={venue} className={quote?.status === "ok" ? "" : "muted-cell"}>
                      <div className="quote-symbol">{displaySymbol(quote)}</div>
                      <div>Bid / Ask: {fmt(quote?.bid)} / {fmt(quote?.ask)}</div>
                      <div>Mid: {fmt(quote?.mid)} | 统一价: {fmt(quote ? canonicalPrice(quote) : null)}</div>
                      <div>资金/h: {pct(quote?.fundingRateHourly)}</div>
                      <div>费率 M/T: {pct(quote?.feeMaker)} / {pct(quote?.feeTaker)}</div>
                      <div>{quote?.quoteUnit ?? "-"} · x{fmt(quote?.canonicalMultiplier, 2)} · {quote?.settleAsset ?? "-"}</div>
                      <div className={quote?.status === "ok" ? "status-ok" : "status-bad"}>{statusLabel(quote)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CostBreakdown({ opportunity }: { opportunity: Opportunity }) {
  return (
    <div className="breakdown">
      <span>开仓手续费: ${fmt(opportunity.costBreakdown.openFees)}</span>
      <span>平仓手续费: ${fmt(opportunity.costBreakdown.closeFees)}</span>
      <span>开仓滑点: ${fmt(opportunity.costBreakdown.openSlippage)}</span>
      <span>平仓滑点: ${fmt(opportunity.costBreakdown.closeSlippage)}</span>
      <span>资金费: ${fmt(opportunity.costBreakdown.funding)}</span>
      <span>稳定币折价: ${fmt(opportunity.costBreakdown.stablecoinHaircut)}</span>
      {opportunity.notes.map((note) => <span key={note} className="note">{note}</span>)}
    </div>
  );
}

function Opportunities({ opportunities }: { opportunities: Opportunity[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="section-title">
        <Calculator size={18} />
        <h2>对冲机会排序</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>标的</th>
              <th>做多</th>
              <th>做空</th>
              <th>可执行价差</th>
              <th>红线价差</th>
              <th>总成本</th>
              <th>预计净收益</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">暂无可比较机会</td>
              </tr>
            )}
            {opportunities.map((opportunity) => (
              <React.Fragment key={opportunity.id}>
                <tr className="clickable" onClick={() => setOpenId(openId === opportunity.id ? null : opportunity.id)}>
                  <td className="target">{opportunity.target}</td>
                  <td>{opportunity.longVenue}<br /><span>{opportunity.longSymbol} @ {fmt(opportunity.longEntry)}</span></td>
                  <td>{opportunity.shortVenue}<br /><span>{opportunity.shortSymbol} @ {fmt(opportunity.shortEntry)}</span></td>
                  <td>{fmt(opportunity.executableSpread)}<br /><span>{bps(opportunity.executableSpreadBps)}</span></td>
                  <td className={opportunity.profitable ? "" : "danger"}>{fmt(opportunity.breakEvenSpread)}<br /><span>{bps(opportunity.breakEvenSpreadBps)}</span></td>
                  <td>${fmt(opportunity.totalCost)}</td>
                  <td className={opportunity.netPnl >= 0 ? "positive" : "negative"}>${fmt(opportunity.netPnl)}<br /><span>{bps(opportunity.netReturnBps)}</span></td>
                  <td>{opportunity.profitable ? "高于红线" : "低于红线"}</td>
                </tr>
                {openId === opportunity.id && (
                  <tr>
                    <td colSpan={8}>
                      <CostBreakdown opportunity={opportunity} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function App() {
  const { data, loading, error, reload } = useQuotes();
  const [params, setParams] = useState<CalculationParams>(DEFAULT_PARAMS);
  const quotes = data?.quotes ?? [];
  const opportunities = useMemo(() => calculateOpportunities(quotes, params), [quotes, params]);

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>盘前合约价差对冲仪表盘</h1>
          <p>只读分析：OKX / Binance / Ventuals / TradeXYZ · SPACEX / OPENAI / ANTHROPIC</p>
        </div>
        <button onClick={() => void reload()} disabled={loading}>
          <RefreshCw size={16} />
          {loading ? "刷新中" : "刷新"}
        </button>
      </header>

      {(error || data?.sourceErrors.length) && (
        <section className="alert">
          <AlertTriangle size={18} />
          <div>
            {error && <div>{error}</div>}
            {data?.sourceErrors.map((item) => <div key={`${item.venue}-${item.message}`}>{item.venue}: {item.message}</div>)}
          </div>
        </section>
      )}

      <ParamPanel params={params} setParams={setParams} />
      <div className="meta">
        最近更新：{data ? new Date(data.generatedAt).toLocaleString() : "-"} · 可比较机会 {opportunities.length} 个
      </div>
      <MarketMatrix quotes={quotes} />
      <Opportunities opportunities={opportunities} />

      <section className="panel small-print">
        <div className="section-title">
          <TrendingDown size={18} />
          <h2>计算约定</h2>
        </div>
        <p>正资金费表示多头付空头；负资金费表示空头付多头。默认稳定币按 1:1 USD 处理，haircut 可手动调整。不可访问、缺失或计价不可转换的市场不会进入机会排序。</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
