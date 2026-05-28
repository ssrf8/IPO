import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Calculator, Check, Copy, HelpCircle, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { calculateOpportunities, DEFAULT_PARAMS } from "../shared/calculations";
import { canonicalPrice } from "../shared/calculations";
import { TARGETS } from "../shared/markets.config";
import type { CalculationParams, DashboardResponse, HistoricalSpreadsResponse, MarketQuote, Opportunity, Target, Venue } from "../shared/types";
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

function useHistory() {
  const [data, setData] = useState<HistoricalSpreadsResponse | null>(null);
  const [days, setDays] = useState(2);
  const [interval, setIntervalValue] = useState<"1h" | "4h" | "1d">("1h");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/history-spreads?days=${days}&interval=${interval}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setData(await response.json() as HistoricalSpreadsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "历史价差请求失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [days, interval]);

  return { data, days, setDays, interval, setIntervalValue, loading, error, reload: load };
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
            <p>总本金会按同一对冲数量拆成多头本金和空头本金；价格高的一腿名义金额会更大，价格低的一腿名义金额会更小。</p>
            <p>交易手续费按配置里的 maker/taker 费率计算，开仓和平仓都会算；真实账户 VIP、返佣、平台币抵扣不会自动读取。</p>
            <p>资金费：Binance、OKX、Ventuals、TradeXYZ 都会优先读取公开接口的最新 funding 并小时化；缺失时才按配置 fallback 或 0 处理。</p>
            <p>滑点可用手动 bps，也可用订单簿 VWAP。订单簿深度不足时会回退到手动滑点，并在详情里提示。</p>
            <p>成本缓冲 = 总成本 / 对冲数量；盈亏平衡剩余价差 = 当前可执行价差 - 成本缓冲。平仓时剩余价差低于这个红线才是正收益。</p>
            <p>稳定币 haircut 用于给 USDT/USDC/USDH 的结算差异加成本，默认全部按 1:1 USD。</p>
          </div>
        </div>
      </div>
      <div className="toolbar">
        <label>
          总本金
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
    <div className="detail-stack">
      <div className="scenario">
        <div>
          <strong>默认收敛</strong>
          <span>按可执行开仓价中点估算：空头从 {fmt(opportunity.shortEntry)} 跌到 {fmt(opportunity.expectedClose)}，多头从 {fmt(opportunity.longEntry)} 涨到 {fmt(opportunity.expectedClose)}。这只是统一参考价，实际看剩余价差。</span>
        </div>
        <div>
          <strong>盈亏红线</strong>
          <span>{opportunity.shortVenue} - {opportunity.longVenue} 剩余价差大于 {fmt(opportunity.breakEvenSpread)} 时会转亏；成本缓冲为 {fmt(opportunity.costSpread)}。若多头价在 {fmt(opportunity.expectedClose)}，空头红线为 {fmt(opportunity.breakEvenShortPriceAtLongClose)}。</span>
        </div>
        <div>
          <strong>最大收益参考</strong>
          <span>在当前简化模型里，价差收敛到 {fmt(opportunity.maxProfitSpread)} 时收益最高，约 ${fmt(opportunity.maxProfitPnl)}</span>
        </div>
      </div>
      <div className="breakdown">
        <span>开仓手续费: ${fmt(opportunity.costBreakdown.openFees)}</span>
        <span>平仓手续费: ${fmt(opportunity.costBreakdown.closeFees)}</span>
        <span>开仓滑点: ${fmt(opportunity.costBreakdown.openSlippage)}</span>
        <span>平仓滑点: ${fmt(opportunity.costBreakdown.closeSlippage)}</span>
        <span>资金费: ${fmt(opportunity.costBreakdown.funding)}</span>
        <span>稳定币折价: ${fmt(opportunity.costBreakdown.stablecoinHaircut)}</span>
        {opportunity.notes.map((note) => <span key={note} className="note">{note}</span>)}
      </div>
    </div>
  );
}

function Opportunities({ opportunities, params }: { opportunities: Opportunity[]; params: CalculationParams }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyOpportunity(opportunity: Opportunity, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const text = formatOpportunityForClipboard(opportunity, params);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(opportunity.id);
      window.setTimeout(() => setCopiedId((current) => (current === opportunity.id ? null : current)), 1800);
    } catch {
      window.prompt("复制失败，可以手动复制以下内容", text);
    }
  }

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
              <th>收敛目标</th>
              <th>价差 / 红线</th>
              <th>总成本</th>
              <th>预计净收益</th>
              <th>状态</th>
              <th>复制</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">暂无可比较机会</td>
              </tr>
            )}
            {opportunities.map((opportunity) => (
              <React.Fragment key={opportunity.id}>
                <tr className="clickable" onClick={() => setOpenId(openId === opportunity.id ? null : opportunity.id)}>
                  <td className="target">{opportunity.target}</td>
                  <td>{opportunity.longVenue}<br /><span>{opportunity.longSymbol} @ {fmt(opportunity.longEntry)}</span></td>
                  <td>{opportunity.shortVenue}<br /><span>{opportunity.shortSymbol} @ {fmt(opportunity.shortEntry)}</span></td>
                  <td>
                    空跌到 {fmt(opportunity.expectedClose)}<br />
                    <span>多涨到 {fmt(opportunity.expectedClose)}</span>
                  </td>
                  <td className={opportunity.profitable ? "" : "danger"}>
                    当前 {fmt(opportunity.executableSpread)}<br />
                    <span>剩余红线 {fmt(opportunity.breakEvenSpread)} · {bps(opportunity.breakEvenSpreadBps)}</span>
                  </td>
                  <td>${fmt(opportunity.totalCost)}</td>
                  <td className={opportunity.netPnl >= 0 ? "positive" : "negative"}>${fmt(opportunity.netPnl)}<br /><span>{bps(opportunity.netReturnBps)}</span></td>
                  <td>
                    {opportunity.profitable ? "默认收敛为正" : "默认收敛不足"}<br />
                    <span>剩余价差低于红线才盈利</span>
                  </td>
                  <td>
                    <button className="copy-button" type="button" onClick={(event) => void copyOpportunity(opportunity, event)}>
                      {copiedId === opportunity.id ? <Check size={15} /> : <Copy size={15} />}
                      {copiedId === opportunity.id ? "已复制" : "复制"}
                    </button>
                  </td>
                </tr>
                {openId === opportunity.id && (
                  <tr>
                    <td colSpan={9}>
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

function formatOpportunityForClipboard(opportunity: Opportunity, params: CalculationParams) {
  return [
    `【盘前合约对冲方案】${opportunity.target}`,
    "",
    `方向：低价做多，高价做空`,
    `做多交易所：${opportunity.longVenue}`,
    `做多合约：${opportunity.longSymbol}`,
    `做多开仓价：${fmt(opportunity.longEntry)}`,
    `做空交易所：${opportunity.shortVenue}`,
    `做空合约：${opportunity.shortSymbol}`,
    `做空开仓价：${fmt(opportunity.shortEntry)}`,
    "",
    `总投入名义本金：${fmt(opportunity.totalNotional)} USD`,
    `做多名义本金：${fmt(opportunity.longNotional)} USD`,
    `做空名义本金：${fmt(opportunity.shortNotional)} USD`,
    `估算对冲数量：${fmt(opportunity.hedgeQuantity, 6)} 统一价格单位`,
    `预计持仓时间：${params.holdingHours} 小时`,
    `开仓费率模式：${params.feeModeOpen}`,
    `平仓费率模式：${params.feeModeClose}`,
    `滑点模式：${params.slippageMode}`,
    `手动滑点：${params.manualSlippageBps} bps`,
    "",
    `当前可执行价差：${fmt(opportunity.executableSpread)} (${bps(opportunity.executableSpreadBps)})`,
    `默认止盈/收敛参考价：${fmt(opportunity.expectedClose)}（按可执行开仓价中点估算，仅为统一参考价，不是必要条件）`,
    `成本折算价差：${fmt(opportunity.costSpread)} (${bps(opportunity.costSpreadBps)})`,
    `盈亏红线：平仓时 ${opportunity.shortVenue} - ${opportunity.longVenue} 剩余价差低于 ${fmt(opportunity.breakEvenSpread)} (${bps(opportunity.breakEvenSpreadBps)}) 才盈利`,
    `红线价格参考：若${opportunity.longVenue} 多头价为 ${fmt(opportunity.expectedClose)}，${opportunity.shortVenue} 空头价高于 ${fmt(opportunity.breakEvenShortPriceAtLongClose)} 后转亏`,
    `红线价格参考：若${opportunity.shortVenue} 空头价为 ${fmt(opportunity.expectedClose)}，${opportunity.longVenue} 多头价低于 ${fmt(opportunity.breakEvenLongPriceAtShortClose)} 后转亏`,
    `风险观察线：这不是止损单；若平仓时剩余价差仍高于 ${fmt(opportunity.breakEvenSpread)}，按当前成本模型会亏损`,
    `最大收益参考：价差收敛到 ${fmt(opportunity.maxProfitSpread)} 时，约 ${fmt(opportunity.maxProfitPnl)} USD`,
    "",
    `开仓手续费：${fmt(opportunity.costBreakdown.openFees)} USD`,
    `平仓手续费：${fmt(opportunity.costBreakdown.closeFees)} USD`,
    `开仓滑点：${fmt(opportunity.costBreakdown.openSlippage)} USD`,
    `平仓滑点：${fmt(opportunity.costBreakdown.closeSlippage)} USD`,
    `资金费：${fmt(opportunity.costBreakdown.funding)} USD`,
    `稳定币折价成本：${fmt(opportunity.costBreakdown.stablecoinHaircut)} USD`,
    `总成本：${fmt(opportunity.totalCost)} USD`,
    "",
    `预计毛收益：${fmt(opportunity.grossPnl)} USD`,
    `预计净收益：${fmt(opportunity.netPnl)} USD (${bps(opportunity.netReturnBps)})`,
    `状态：${opportunity.profitable ? "按默认收敛目标为正收益" : "按默认收敛目标为负收益或边际不足"}`,
    opportunity.notes.length ? `备注：${opportunity.notes.join("；")}` : ""
  ].filter(Boolean).join("\n");
}

function HistoryPanel() {
  const history = useHistory();
  const [target, setTarget] = useState<Target>("SPACEX");
  const [series, setSeries] = useState<"maxMinSpread" | "okxBinance" | "okxVentuals" | "binanceVentuals" | "ventualsTradexyz">("maxMinSpread");
  const filteredRows = useMemo(
    () => [...(history.data?.rows ?? [])].filter((row) => row.target === target).sort((a, b) => a.time - b.time),
    [history.data, target]
  );
  const rows = useMemo(() => [...filteredRows].reverse().slice(0, 80), [filteredRows]);
  const chart = useMemo(() => buildSpreadSeries(filteredRows, series), [filteredRows, series]);
  const summary = useMemo(() => summarizeSpreadSeries(chart.points), [chart.points]);

  return (
    <section className="panel">
      <div className="section-title action-title">
        <div className="title-left">
          <TrendingDown size={18} />
          <h2>历史价差</h2>
        </div>
        <div className="history-actions">
          <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            {TARGETS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={series} onChange={(e) => setSeries(e.target.value as typeof series)}>
            <option value="maxMinSpread">最大价差</option>
            <option value="okxBinance">OKX - Binance</option>
            <option value="okxVentuals">OKX - Ventuals</option>
            <option value="binanceVentuals">Binance - Ventuals</option>
            <option value="ventualsTradexyz">Ventuals - TradeXYZ</option>
          </select>
          <select value={history.days} onChange={(e) => history.setDays(Number(e.target.value))}>
            <option value={2}>最近 2 天</option>
            <option value={7}>最近 7 天</option>
            <option value={12}>最近 12 天</option>
          </select>
          <select value={history.interval} onChange={(e) => history.setIntervalValue(e.target.value as "1h" | "4h" | "1d")}>
            <option value="1h">1小时</option>
            <option value="4h">4小时</option>
            <option value="1d">1天</option>
          </select>
          <button onClick={() => void history.reload()} disabled={history.loading}>
            <RefreshCw size={16} />
            {history.loading ? "刷新中" : "刷新历史"}
          </button>
        </div>
      </div>
      {history.error && <div className="inline-error">{history.error}</div>}
      {Boolean(history.data?.warnings.length) && (
        <div className="inline-warn">
          {history.data?.warnings.slice(0, 3).map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}
      <div className="meta table-meta">
        最近更新：{history.data ? new Date(history.data.generatedAt).toLocaleString() : "-"} · 图表 {chart.points.length} 个点 · 表格显示 {rows.length} 条 · 价差均为统一价格尺度
      </div>
      <SpreadChart title={chart.label} points={chart.points} summary={summary} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>标的</th>
              <th>OKX</th>
              <th>Binance</th>
              <th>Ventuals</th>
              <th>TradeXYZ</th>
              <th>最高 / 最低</th>
              <th>最大价差</th>
              <th>OKX-Binance</th>
              <th>OKX-Ventuals</th>
              <th>Binance-Ventuals</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="empty">暂无历史数据</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={`${row.target}-${row.time}`}>
                <td>{new Date(row.time).toLocaleString()}</td>
                <td className="target">{row.target}</td>
                <td>{fmt(row.prices.okx)}</td>
                <td>{fmt(row.prices.binance)}</td>
                <td>{fmt(row.prices.ventuals)}</td>
                <td>{fmt(row.prices.tradexyz)}</td>
                <td>{row.maxVenue ?? "-"} / {row.minVenue ?? "-"}</td>
                <td>{fmt(row.maxMinSpread)}<br /><span>{bps(row.maxMinSpreadBps)}</span></td>
                <td>{fmt(row.spreads.okxBinance)}</td>
                <td>{fmt(row.spreads.okxVentuals)}</td>
                <td>{fmt(row.spreads.binanceVentuals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildSpreadSeries(
  rows: HistoricalSpreadsResponse["rows"],
  series: "maxMinSpread" | "okxBinance" | "okxVentuals" | "binanceVentuals" | "ventualsTradexyz"
) {
  const labels = {
    maxMinSpread: "最高-最低价差",
    okxBinance: "OKX - Binance",
    okxVentuals: "OKX - Ventuals",
    binanceVentuals: "Binance - Ventuals",
    ventualsTradexyz: "Ventuals - TradeXYZ"
  };
  const points = rows
    .map((row) => {
      const rawValue = series === "maxMinSpread" ? row.maxMinSpread : row.spreads[series];
      return rawValue == null ? null : { time: row.time, value: Math.abs(rawValue), row };
    })
    .filter((point): point is { time: number; value: number; row: HistoricalSpreadsResponse["rows"][number] } => Boolean(point));
  return { label: labels[series], points };
}

function summarizeSpreadSeries(points: Array<{ time: number; value: number }>) {
  if (points.length === 0) {
    return { latest: null, min: null, max: null, shrinkBars: 0, shrinkPct: null, latestChange: null };
  }
  const latest = points[points.length - 1].value;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  let shrinkBars = 0;
  for (let index = points.length - 1; index > 0; index -= 1) {
    if (points[index].value < points[index - 1].value) shrinkBars += 1;
    else break;
  }
  const beforeShrink = points[points.length - 1 - shrinkBars]?.value ?? latest;
  const shrinkPct = beforeShrink === 0 ? null : (beforeShrink - latest) / beforeShrink * 100;
  const previous = points[points.length - 2]?.value;
  const latestChange = previous == null ? null : latest - previous;
  return { latest, min, max, shrinkBars, shrinkPct, latestChange };
}

function SpreadChart({
  title,
  points,
  summary
}: {
  title: string;
  points: Array<{ time: number; value: number; row: HistoricalSpreadsResponse["rows"][number] }>;
  summary: ReturnType<typeof summarizeSpreadSeries>;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 920;
  const height = 260;
  const padding = { top: 22, right: 20, bottom: 36, left: 64 };
  const values = points.map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const x = (index: number) => padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((max - value) / span) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point.value).toFixed(2)}`).join(" ");
  const area = points.length
    ? `${line} L ${x(points.length - 1).toFixed(2)} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`
    : "";
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const isShrinking = previous ? latest.value < previous.value : false;
  const hoverPoint = hoverIndex == null ? null : points[hoverIndex];
  const safeHoverIndex = hoverIndex ?? 0;
  const tooltipWidth = 190;
  const tooltipHeight = 118;
  const tooltipX = hoverPoint ? Math.min(width - padding.right - tooltipWidth, Math.max(padding.left, x(safeHoverIndex) + 12)) : 0;
  const tooltipY = hoverPoint ? Math.max(padding.top, y(hoverPoint.value) - tooltipHeight - 10) : 0;
  const timeTicks = points.length
    ? [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(ratio * (points.length - 1)))
    : [];

  function handleChartHover(event: React.MouseEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = (event.clientX - rect.left) / rect.width * width;
    const plotWidth = width - padding.left - padding.right;
    const ratio = Math.min(1, Math.max(0, (relativeX - padding.left) / plotWidth));
    setHoverIndex(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className="chart-wrap">
      <div className="chart-summary">
        <div><span>当前价差</span><strong>{fmt(summary.latest)}</strong></div>
        <div><span>最低</span><strong>{fmt(summary.min)}</strong></div>
        <div><span>最高</span><strong>{fmt(summary.max)}</strong></div>
        <div><span>连续收窄</span><strong>{summary.shrinkBars} 根</strong></div>
        <div><span>本轮收窄</span><strong>{summary.shrinkPct == null ? "-" : `${fmt(summary.shrinkPct, 2)}%`}</strong></div>
        <div><span>最近一根</span><strong className={isShrinking ? "positive" : "negative"}>{summary.latestChange == null ? "-" : fmt(summary.latestChange)}</strong></div>
      </div>
      <div className="chart-box">
        {points.length === 0 ? (
          <div className="empty chart-empty">暂无可画图的历史价差</div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${title} 历史价差图`}
            onMouseMove={handleChartHover}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis" />
            <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="axis" />
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const value = max - span * ratio;
              const yy = padding.top + ratio * (height - padding.top - padding.bottom);
              return (
                <g key={ratio}>
                  <line x1={padding.left} y1={yy} x2={width - padding.right} y2={yy} className="grid-line" />
                  <text x={padding.left - 10} y={yy + 4} textAnchor="end" className="chart-label">{fmt(value)}</text>
                </g>
              );
            })}
            <path d={area} className="chart-area" />
            <path d={line} className="chart-line" />
            {timeTicks.map((index) => (
              <g key={index}>
                <line x1={x(index)} y1={height - padding.bottom} x2={x(index)} y2={height - padding.bottom + 5} className="axis" />
                <text x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="chart-label">
                  {new Date(points[index].time).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </text>
              </g>
            ))}
            {latest && (
              <circle cx={x(points.length - 1)} cy={y(latest.value)} r="4" className={isShrinking ? "chart-point good" : "chart-point bad"} />
            )}
            {hoverPoint && (
              <g>
                <line x1={x(safeHoverIndex)} y1={padding.top} x2={x(safeHoverIndex)} y2={height - padding.bottom} className="hover-line" />
                <circle cx={x(safeHoverIndex)} cy={y(hoverPoint.value)} r="5" className="chart-point hover" />
                <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" className="chart-tooltip" />
                <text x={tooltipX + 10} y={tooltipY + 18} className="tooltip-text strong">{new Date(hoverPoint.time).toLocaleString()}</text>
                <text x={tooltipX + 10} y={tooltipY + 38} className="tooltip-text">价差: {fmt(hoverPoint.value)}</text>
                <text x={tooltipX + 10} y={tooltipY + 58} className="tooltip-text">OKX: {fmt(hoverPoint.row.prices.okx)}</text>
                <text x={tooltipX + 10} y={tooltipY + 76} className="tooltip-text">Binance: {fmt(hoverPoint.row.prices.binance)}</text>
                <text x={tooltipX + 10} y={tooltipY + 94} className="tooltip-text">Ventuals: {fmt(hoverPoint.row.prices.ventuals)}</text>
                <text x={tooltipX + 10} y={tooltipY + 112} className="tooltip-text">TradeXYZ: {fmt(hoverPoint.row.prices.tradexyz)}</text>
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
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
      <Opportunities opportunities={opportunities} params={params} />
      <HistoryPanel />

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
