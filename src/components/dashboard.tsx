import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  CalendarDays,
  ChartCandlestick,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  LayoutDashboard,
  LineChart,
  Newspaper,
  NotebookPen,
  Pencil,
  Radar,
  RefreshCw,
  Save,
  Settings,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  WalletCards,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  actionMemo,
  biasScore,
  calendarEvents as fallbackCalendarEvents,
  holdings,
  keyIssues,
  leadingIndicators,
  marketStatus,
  newsKeywords,
  watchlist,
} from '@/data/mock-dashboard'
import { cn } from '@/lib/utils'
import type {
  ActionQueueItem,
  BiasScore,
  CalendarEvent,
  Direction,
  DisclosureItem,
  Holding,
  InvestmentJournal,
  LiveNewsItem,
  MarketIndicator,
  MarketQuote,
  WatchItem,
} from '@/types/market'

const navItems = [
  { id: 'dashboard', label: '대시보드', subtitle: '국내장 예열과 포트폴리오 영향', icon: LayoutDashboard },
  { id: 'holdings', label: '보유종목', subtitle: '보유 비중, 손익, 이슈 영향', icon: WalletCards },
  { id: 'watchlist', label: '관심종목', subtitle: '매수가 조건과 이슈 트리거', icon: Star },
  { id: 'radar', label: '시장 레이더', subtitle: '선행 지표와 국내장 연결', icon: Radar },
  { id: 'forecast', label: '예측', subtitle: '내일장 시나리오와 조건', icon: LineChart },
  { id: 'news', label: '뉴스', subtitle: '종목별 이슈와 영향도', icon: Newspaper },
  { id: 'disclosures', label: '공시', subtitle: 'DART 공시와 실적 원문', icon: FileText },
  { id: 'calendar', label: '캘린더', subtitle: '실적, 매크로, 정책 일정', icon: CalendarDays },
  { id: 'alerts', label: '알림', subtitle: '오늘 우선순위 액션', icon: Bell },
  { id: 'notes', label: '투자노트', subtitle: '시나리오와 장 후 리뷰', icon: NotebookPen },
  { id: 'settings', label: '설정', subtitle: '추적 대상과 데이터 주기', icon: Settings },
] as const

type PageId = (typeof navItems)[number]['id']

type QuoteStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'fallback' | 'error'
type CalendarStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
type NewsStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
type DisclosureStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'fallback' | 'error'
type DataHealthStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'fallback' | 'error' | 'missing' | 'planned' | 'local'

type DataHealthService = {
  id: string
  name: string
  status: DataHealthStatus
  configured: boolean
  source: string
  cadence: string
  coverage: string[]
  summary: string
  nextAction: string
}

type HealthApiResponse = {
  configured: boolean
  source: string
  environment: string
  fetchedAt: string
  status: 'ready' | 'partial'
  services: DataHealthService[]
  message?: string
}

type QuotesApiResponse = {
  configured: boolean
  source: string
  fetchedAt: string
  status: 'ready' | 'partial' | 'fallback'
  quotes: MarketQuote[]
  errors: { symbol: string; sourceSymbol: string; message: string }[]
  message?: string
}

type CalendarApiResponse = {
  configured: boolean
  source: string
  fetchedAt: string
  status: 'ready' | 'fallback'
  events: CalendarEvent[]
  message?: string
}

type DisclosureApiResponse = {
  configured: boolean
  source: string
  fetchedAt: string
  status: 'ready' | 'partial' | 'fallback'
  items: DisclosureItem[]
  errors: { symbol: string; message: string }[]
  message?: string
}

type ForecastScenario = {
  id: 'base' | 'upside' | 'downside'
  label: string
  score: number
  probability: number
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  summary: string
  triggers: string[]
  action: string
}

type ForecastImpact = {
  id: string
  label: string
  source: 'indicator' | 'news' | 'disclosure' | 'calendar' | 'portfolio'
  impact: number
  direction: Direction
  reason: string
  relatedSymbols: string[]
}

type MarketForecast = {
  baseScore: number
  openingBias: string
  expectedOpenRange: string
  confidence: 'low' | 'medium' | 'high'
  summary: string
  scenarios: ForecastScenario[]
  impacts: ForecastImpact[]
  checklist: string[]
}

type MarketStatusView = typeof marketStatus
type StoredDashboardData = {
  holdings: Holding[]
  watchlist: WatchItem[]
  journal: InvestmentJournal
}

type DashboardBackup = {
  version: 1
  exportedAt: string
  data: StoredDashboardData
}

type DashboardSnapshot = {
  holdings: Holding[]
  watchlist: WatchItem[]
  storedData: StoredDashboardData
  leadingIndicators: MarketIndicator[]
  biasScore: BiasScore
  marketStatus: MarketStatusView
  quoteStatus: QuoteStatus
  quoteMessage: string
  liveQuoteCount: number
  fetchedAt: string | null
  calendarEvents: CalendarEvent[]
  calendarStatus: CalendarStatus
  calendarMessage: string
  liveNews: LiveNewsItem[]
  newsStatus: NewsStatus
  newsMessage: string
  disclosures: DisclosureItem[]
  disclosureStatus: DisclosureStatus
  disclosureMessage: string
  forecast: MarketForecast
  actionQueue: ActionQueueItem[]
  journal: InvestmentJournal
}

const storageKey = 'tracking-money-dashboard-v1'

const indicatorSymbols = [
  'NQ=F',
  'ES=F',
  'SOX',
  'VIX',
  'DXY',
  'US10Y',
  'USD/KRW',
]

const inverseIndicators = new Set(['VIX', 'DXY', 'US10Y', 'USD/KRW'])

const liveIndicatorNotes: Record<string, string> = {
  'NQ=F': '국내 성장주와 코스닥 심리에 선행 반영',
  'ES=F': '미국 전체 위험선호의 기본 온도',
  SOX: '삼성전자와 SK하이닉스에 가장 직접적인 선행 신호',
  VIX: '하락하면 위험선호, 상승하면 변동성 부담',
  DXY: '강달러는 외국인 수급과 환율에 부담',
  US10Y: '금리 상승은 성장주 밸류에이션 부담',
  'USD/KRW': '달러/원 상승은 국내장 수급의 핵심 부담',
}

const confidenceLabel = {
  low: '낮음',
  medium: '중간',
  high: '높음',
}

const importanceLabel = {
  low: '낮음',
  medium: '보통',
  high: '높음',
}

const directionLabel = {
  positive: '긍정',
  negative: '부담',
  neutral: '중립',
  mixed: '혼재',
}

const calendarStatusLabel = {
  confirmed: '확정',
  estimated: '추정',
  watch: '점검',
}

const calendarTypeLabel = {
  earnings: '실적',
  macro: '매크로',
  policy: '정책',
  company: '기업',
  dividend: '배당',
}

const actionPriorityLabel = {
  critical: '긴급',
  high: '높음',
  medium: '보통',
  low: '낮음',
}

const actionCategoryLabel = {
  market: '시장',
  portfolio: '보유',
  watchlist: '관심',
  news: '뉴스',
  calendar: '일정',
  disclosure: '공시',
}

const watchStatusLabel = {
  near: '근접',
  waiting: '대기',
  alert: '확인',
}

const dataHealthStatusLabel: Record<DataHealthStatus, string> = {
  idle: '대기',
  loading: '확인 중',
  ready: '연결',
  partial: '부분 연결',
  fallback: '대체 데이터',
  error: '오류',
  missing: '설정 필요',
  planned: '예정',
  local: '로컬 저장',
}

function dataHealthVariant(status: DataHealthStatus): 'positive' | 'negative' | 'warning' | 'neutral' {
  if (status === 'ready' || status === 'local') return 'positive'
  if (status === 'partial' || status === 'fallback' || status === 'planned' || status === 'loading') return 'warning'
  if (status === 'error' || status === 'missing') return 'negative'
  return 'neutral'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function createDefaultJournal(date = getKstDateKey()): InvestmentJournal {
  return {
    date,
    preMarketPlan: '',
    riskPlan: '',
    afterMarketReview: '',
    completedActionIds: [],
    lastSavedAt: null,
  }
}

function normalizeJournal(rawJournal: unknown): InvestmentJournal {
  const today = getKstDateKey()
  if (!isRecord(rawJournal) || rawJournal.date !== today) return createDefaultJournal(today)

  return {
    date: textValue(rawJournal.date, today),
    preMarketPlan: textValue(rawJournal.preMarketPlan),
    riskPlan: textValue(rawJournal.riskPlan),
    afterMarketReview: textValue(rawJournal.afterMarketReview),
    completedActionIds: stringArrayValue(rawJournal.completedActionIds),
    lastSavedAt: typeof rawJournal.lastSavedAt === 'string' ? rawJournal.lastSavedAt : null,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseNumericInput(value: string, fallback = 0) {
  const parsed = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeUserSymbol(value: string) {
  return value.trim().toUpperCase()
}

function defaultMarketForSymbol(symbol: string): 'KR' | 'US' {
  return /^\d{6}$/.test(symbol) ? 'KR' : 'US'
}

function normalizeMarket(value: unknown, symbol: string): 'KR' | 'US' {
  return value === 'KR' || value === 'US' ? value : defaultMarketForSymbol(symbol)
}

function normalizeDirection(value: unknown): Direction {
  return value === 'positive' || value === 'negative' || value === 'neutral' || value === 'mixed' ? value : 'neutral'
}

function normalizeWatchStatus(value: unknown, targetBuyPrice: number, currentPrice: number): WatchItem['status'] {
  if (value === 'near' || value === 'waiting' || value === 'alert') return value
  if (targetBuyPrice > 0 && currentPrice <= targetBuyPrice * 1.03) return 'near'
  return 'waiting'
}

function dedupeBySymbol<T extends { symbol: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.symbol, item])).values())
}

function normalizeImportedHolding(value: unknown): Holding | null {
  if (!isRecord(value)) return null

  const symbol = normalizeUserSymbol(textValue(value.symbol))
  if (!symbol) return null

  const averagePrice = numberValue(value.averagePrice)
  const currentPrice = numberValue(value.currentPrice, averagePrice)

  return {
    symbol,
    name: textValue(value.name, symbol),
    market: normalizeMarket(value.market, symbol),
    quantity: Math.max(0, numberValue(value.quantity)),
    averagePrice: Math.max(0, averagePrice),
    currentPrice: Math.max(0, currentPrice),
    dayChange: numberValue(value.dayChange),
    portfolioWeight: clamp(numberValue(value.portfolioWeight), 0, 100),
    impact: normalizeDirection(value.impact),
    impactNote: textValue(value.impactNote, '직접 가져온 백업 데이터입니다.'),
  }
}

function normalizeImportedWatchItem(value: unknown): WatchItem | null {
  if (!isRecord(value)) return null

  const symbol = normalizeUserSymbol(textValue(value.symbol))
  if (!symbol) return null

  const targetBuyPrice = Math.max(0, numberValue(value.targetBuyPrice))
  const currentPrice = Math.max(0, numberValue(value.currentPrice, targetBuyPrice))
  const distanceToBuy =
    Number.isFinite(numberValue(value.distanceToBuy, Number.NaN)) || targetBuyPrice <= 0
      ? numberValue(value.distanceToBuy)
      : round(((currentPrice - targetBuyPrice) / targetBuyPrice) * 100, 1)

  return {
    symbol,
    name: textValue(value.name, symbol),
    targetBuyPrice,
    currentPrice,
    distanceToBuy,
    trigger: textValue(value.trigger, '가져온 관심종목입니다.'),
    status: normalizeWatchStatus(value.status, targetBuyPrice, currentPrice),
  }
}

function normalizeStoredDashboardData(value: unknown): StoredDashboardData | null {
  const candidate = isRecord(value) && isRecord(value.data) ? value.data : value
  if (!isRecord(candidate) || !Array.isArray(candidate.holdings) || !Array.isArray(candidate.watchlist)) return null

  return {
    holdings: dedupeBySymbol(candidate.holdings.map(normalizeImportedHolding).filter((item): item is Holding => item !== null)),
    watchlist: dedupeBySymbol(candidate.watchlist.map(normalizeImportedWatchItem).filter((item): item is WatchItem => item !== null)),
    journal: normalizeJournal(candidate.journal),
  }
}

function createDashboardBackup(data: StoredDashboardData): DashboardBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  }
}

function formatDashboardBackup(data: StoredDashboardData) {
  return JSON.stringify(createDashboardBackup(data), null, 2)
}

function parseDashboardBackup(rawJson: string): { ok: true; data: StoredDashboardData; message: string } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(rawJson) as unknown
    const data = normalizeStoredDashboardData(parsed)
    if (!data) {
      return {
        ok: false,
        message: '백업 형식이 맞지 않습니다. holdings와 watchlist 배열이 있는 JSON을 넣어주세요.',
      }
    }

    return {
      ok: true,
      data,
      message: `보유 ${data.holdings.length}개, 관심 ${data.watchlist.length}개, 투자노트를 가져왔습니다.`,
    }
  } catch {
    return {
      ok: false,
      message: 'JSON을 읽지 못했습니다. 쉼표나 따옴표가 빠졌는지 확인해주세요.',
    }
  }
}

function downloadDashboardBackup(data: StoredDashboardData) {
  const blob = new Blob([formatDashboardBackup(data)], { type: 'application/json' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `tracking-money-backup-${getKstDateKey()}.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function loadStoredDashboardData(): StoredDashboardData | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null

    return normalizeStoredDashboardData(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function saveStoredDashboardData(data: StoredDashboardData) {
  window.localStorage.setItem(storageKey, JSON.stringify(data))
}

function resetStoredDashboardData() {
  window.localStorage.removeItem(storageKey)
}

function quoteKey(symbol: string) {
  return symbol.toUpperCase()
}

function quoteBySymbol(quotes: MarketQuote[]) {
  return new Map(quotes.map((quote) => [quoteKey(quote.symbol), quote]))
}

function getQuote(quoteMap: Map<string, MarketQuote>, symbol: string) {
  return quoteMap.get(quoteKey(symbol))
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString('en-US', {
    maximumFractionDigits,
  })
}

function formatIndicatorValue(symbol: string, value: number) {
  if (symbol === 'US10Y') return `${value.toFixed(2)}%`
  if (symbol === 'USD/KRW') return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  if (symbol === 'VIX') return value.toFixed(2)
  return formatNumber(value, value >= 1000 ? 2 : 3)
}

function formatMarketTime(value: string | null) {
  if (!value) return marketStatus.lastUpdated
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return marketStatus.lastUpdated

  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function getKoreaOpenText(now = new Date()) {
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const open = new Date(kstNow)
  open.setHours(9, 0, 0, 0)

  if (kstNow.getTime() >= open.getTime()) {
    return '진행 중'
  }

  const diffMs = open.getTime() - kstNow.getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000)
  return `${hours}시간 ${minutes}분 전`
}

function getKstDateKey(now = new Date()) {
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const year = kstNow.getFullYear()
  const month = String(kstNow.getMonth() + 1).padStart(2, '0')
  const day = String(kstNow.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isTodayCalendarEvent(event: CalendarEvent) {
  return event.date === '오늘' || event.absoluteDate === getKstDateKey()
}

function calendarEventStatusVariant(event: CalendarEvent): 'positive' | 'warning' | 'neutral' {
  if (event.status === 'confirmed') return 'positive'
  if (event.status === 'estimated') return 'warning'
  return 'neutral'
}

function getDirectionFromChange(symbol: string, changePercent: number | null | undefined): Direction {
  if (changePercent === null || changePercent === undefined || Math.abs(changePercent) < 0.03) return 'neutral'
  const positive = inverseIndicators.has(symbol) ? changePercent < 0 : changePercent > 0
  return positive ? 'positive' : 'negative'
}

function getSignalFromDirection(direction: Direction): MarketIndicator['signal'] {
  if (direction === 'positive') return 'risk-on'
  if (direction === 'negative') return 'risk-off'
  return 'watch'
}

function getImpactFromChange(changePercent: number | null | undefined): Direction {
  if (changePercent === null || changePercent === undefined || Math.abs(changePercent) < 0.4) return 'neutral'
  return changePercent > 0 ? 'positive' : 'negative'
}

function buildIndicatorChartData(indicators: MarketIndicator[]) {
  return indicators.map((indicator) => ({
    symbol: indicator.symbol,
    change: indicator.change,
  }))
}

function buildBiasTimeline(score: number) {
  const base = clamp(score - 22, 0, 100)

  return [
    { time: '23:00', score: clamp(Math.round(base), 0, 100) },
    { time: '01:00', score: clamp(Math.round(base + 8), 0, 100) },
    { time: '03:00', score: clamp(Math.round(base + 14), 0, 100) },
    { time: '05:00', score: clamp(Math.round(base + 18), 0, 100) },
    { time: '현재', score },
  ]
}

function directionVariant(direction: Direction) {
  if (direction === 'positive') return 'positive'
  if (direction === 'negative') return 'negative'
  if (direction === 'mixed') return 'warning'
  return 'neutral'
}

function directionIcon(direction: Direction) {
  if (direction === 'positive') return <TrendingUp className="size-4" />
  if (direction === 'negative') return <TrendingDown className="size-4" />
  return <Activity className="size-4" />
}

function formatChange(value: number) {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2)}%`
}

function formatCurrency(value: number, market: 'KR' | 'US') {
  return market === 'KR'
    ? value.toLocaleString('ko-KR')
    : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function formatSignedCurrency(value: number, market: 'KR' | 'US') {
  const prefix = value >= 0 ? '+' : '-'
  const abs = Math.abs(value)
  return market === 'KR'
    ? `${prefix}${abs.toLocaleString('ko-KR')}`
    : `${prefix}$${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function holdingProfit(holding: Holding) {
  return (holding.currentPrice - holding.averagePrice) * holding.quantity
}

function relatedIssues(symbol: string) {
  return keyIssues.filter((issue) => issue.relatedSymbols.includes(symbol))
}

function mergeHoldingsWithQuotes(baseHoldings: Holding[], quoteMap: Map<string, MarketQuote>) {
  const usdKrw = getQuote(quoteMap, 'USD/KRW')?.price ?? Number(marketStatus.usdKrw.replace(/,/g, ''))
  const updated = baseHoldings.map((holding) => {
    const quote = getQuote(quoteMap, holding.symbol)
    if (!quote) return holding

    const dayChange = quote.changePercent ?? holding.dayChange
    const impact = getImpactFromChange(dayChange)
    return {
      ...holding,
      currentPrice: quote.price,
      dayChange,
      impact,
      impactNote:
        impact === 'positive'
          ? `${quote.source} 기준 가격 흐름이 우호적입니다.`
          : impact === 'negative'
            ? `${quote.source} 기준 가격 흐름이 부담입니다.`
            : `${quote.source} 기준 가격은 전일 대비 큰 방향성이 없습니다.`,
    }
  })

  const positionValues = updated.map((holding) => {
    const marketValue = holding.currentPrice * holding.quantity
    return holding.market === 'US' ? marketValue * usdKrw : marketValue
  })
  const totalValue = positionValues.reduce((sum, value) => sum + value, 0)

  return updated.map((holding, index) => ({
    ...holding,
    portfolioWeight: totalValue > 0 ? round((positionValues[index] / totalValue) * 100, 1) : holding.portfolioWeight,
  }))
}

function mergeWatchlistWithQuotes(baseWatchlist: WatchItem[], quoteMap: Map<string, MarketQuote>) {
  return baseWatchlist.map((item) => {
    const quote = getQuote(quoteMap, item.symbol)
    if (!quote) return item

    const distanceToBuy = round(Math.max(0, ((quote.price - item.targetBuyPrice) / item.targetBuyPrice) * 100), 1)
    const status: WatchItem['status'] =
      Math.abs(quote.changePercent ?? 0) >= 3 ? 'alert' : distanceToBuy <= 3 ? 'near' : 'waiting'

    return {
      ...item,
      currentPrice: quote.price,
      distanceToBuy,
      status,
    }
  })
}

function mergeIndicatorsWithQuotes(quoteMap: Map<string, MarketQuote>) {
  return leadingIndicators.map((indicator) => {
    const quote = getQuote(quoteMap, indicator.symbol)
    if (!quote) return indicator

    const change = quote.changePercent ?? indicator.change
    const direction = getDirectionFromChange(indicator.symbol, change)

    return {
      ...indicator,
      value: formatIndicatorValue(indicator.symbol, quote.price),
      change,
      direction,
      signal: getSignalFromDirection(direction),
      note: liveIndicatorNotes[indicator.symbol] ?? indicator.note,
    }
  })
}

function factorImpact(symbol: string, label: string, rawChange: number | null | undefined, weight: number, limit: number) {
  const change = rawChange ?? 0
  const adjustedChange = inverseIndicators.has(symbol) ? -change : change
  const impact = clamp(Math.round(adjustedChange * weight), -limit, limit)

  return {
    label,
    impact,
    direction: impact > 0 ? 'positive' : impact < 0 ? 'negative' : 'neutral',
  } satisfies BiasScore['positives'][number]
}

function buildLiveBiasScore(indicators: MarketIndicator[], liveQuoteCount: number): BiasScore {
  if (liveQuoteCount === 0) return biasScore

  const indicatorMap = new Map(indicators.map((indicator) => [indicator.symbol, indicator]))
  const factors = [
    factorImpact('SOX', 'SOX 반도체 흐름', indicatorMap.get('SOX')?.change, 9, 24),
    factorImpact('NQ=F', 'NQ 선물 방향', indicatorMap.get('NQ=F')?.change, 8, 18),
    factorImpact('ES=F', 'S&P500 선물 방향', indicatorMap.get('ES=F')?.change, 5, 10),
    factorImpact('VIX', 'VIX 변동성 압력', indicatorMap.get('VIX')?.change, 4, 12),
    factorImpact('USD/KRW', '달러/원 환율 압력', indicatorMap.get('USD/KRW')?.change, 6, 18),
    factorImpact('US10Y', '미국 10년물 금리 압력', indicatorMap.get('US10Y')?.change, 4, 12),
  ]
  const score = clamp(50 + factors.reduce((sum, factor) => sum + factor.impact, 0), 0, 100)
  const positives = factors.filter((factor) => factor.impact >= 0)
  const risks = factors.filter((factor) => factor.impact < 0)
  const confidence: BiasScore['confidence'] = liveQuoteCount >= 8 ? 'high' : liveQuoteCount >= 4 ? 'medium' : 'low'
  const stance: BiasScore['stance'] = score >= 60 ? 'favorable' : score <= 43 ? 'pressure' : 'neutral'
  const summary =
    stance === 'favorable'
      ? '실시간 선행 지표는 국내장에 우호적인 쪽으로 기울어 있습니다.'
      : stance === 'pressure'
        ? '실시간 선행 지표는 국내장에 부담 요인이 더 큽니다.'
        : '실시간 선행 지표는 뚜렷한 한 방향보다 중립에 가깝습니다.'

  return {
    market: 'KOSPI',
    score,
    stance,
    confidence,
    summary,
    positives: positives.length > 0 ? positives : [{ label: '뚜렷한 긍정 요인 없음', impact: 0, direction: 'neutral' }],
    risks: risks.length > 0 ? risks : [{ label: '뚜렷한 부담 요인 없음', impact: 0, direction: 'neutral' }],
  }
}

function newsItemImpact(item: LiveNewsItem) {
  const importanceWeight = item.importance === 'high' ? 2 : item.importance === 'medium' ? 1.25 : 0.75
  const confidenceWeight = item.confidence === 'high' ? 1.2 : item.confidence === 'medium' ? 1 : 0.7
  const directionWeight =
    item.direction === 'positive' ? 1 : item.direction === 'negative' ? -1 : item.direction === 'mixed' ? -0.35 : 0

  return directionWeight * importanceWeight * confidenceWeight
}

function buildNewsBiasFactor(newsItems: LiveNewsItem[], holdingsData: Holding[], watchlistData: WatchItem[]) {
  if (newsItems.length === 0) return null

  const trackedSymbols = new Set([...holdingsData.map((holding) => holding.symbol), ...watchlistData.map((item) => item.symbol)])
  const relatedItems = newsItems.filter((item) => item.relatedSymbols.some((symbol) => trackedSymbols.has(symbol)))
  const targetItems = relatedItems.length > 0 ? relatedItems : newsItems.slice(0, 8)
  const rawImpact = targetItems.reduce((sum, item) => sum + newsItemImpact(item), 0)
  const impact = clamp(Math.round(rawImpact * 3), -14, 14)

  if (impact === 0) return null

  return {
    label: relatedItems.length > 0 ? '보유/관심 뉴스 압력' : '전체 뉴스 심리',
    impact,
    direction: impact > 0 ? 'positive' : 'negative',
  } satisfies BiasScore['positives'][number]
}

function applyNewsBiasFactor(score: BiasScore, factor: BiasScore['positives'][number] | null): BiasScore {
  if (!factor) return score

  const nextScore = clamp(score.score + factor.impact, 0, 100)
  const stance: BiasScore['stance'] = nextScore >= 60 ? 'favorable' : nextScore <= 43 ? 'pressure' : 'neutral'
  const newsSummary =
    factor.impact > 0
      ? '뉴스 흐름은 보유/관심종목에 우호적인 쪽으로 더해졌습니다.'
      : '뉴스 흐름은 보유/관심종목에 부담 요인으로 더해졌습니다.'

  return {
    ...score,
    score: nextScore,
    stance,
    summary: `${score.summary} ${newsSummary}`,
    positives: factor.impact > 0 ? [...score.positives, factor] : score.positives,
    risks: factor.impact < 0 ? [...score.risks, factor] : score.risks,
  }
}

function signedDirection(value: number): Direction {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

function disclosureImpact(item: DisclosureItem) {
  const importanceWeight = item.importance === 'high' ? 9 : item.importance === 'medium' ? 5 : 3
  if (item.direction === 'positive') return importanceWeight
  if (item.direction === 'negative') return -importanceWeight
  if (item.direction === 'mixed') return -Math.round(importanceWeight * 0.55)
  return item.importance === 'high' ? 3 : 1
}

function calendarImpact(event: CalendarEvent) {
  const highWeight = event.importance === 'high' ? 9 : event.importance === 'medium' ? 5 : 2
  const todayWeight = isTodayCalendarEvent(event) ? 1.25 : 1
  return -Math.round(highWeight * todayWeight)
}

function holdingImpactForForecast(holding: Holding) {
  const directionWeight = holding.impact === 'positive' ? 1 : holding.impact === 'negative' ? -1 : holding.impact === 'mixed' ? -0.35 : 0
  return Math.round(directionWeight * Math.min(10, Math.max(2, holding.portfolioWeight / 4)))
}

function buildForecastImpacts({
  biasScoreData,
  holdingsData,
  newsItems,
  eventsData,
  disclosures,
}: {
  biasScoreData: BiasScore
  holdingsData: Holding[]
  newsItems: LiveNewsItem[]
  eventsData: CalendarEvent[]
  disclosures: DisclosureItem[]
}): ForecastImpact[] {
  const indicatorImpacts = [...biasScoreData.positives, ...biasScoreData.risks]
    .filter((factor) => factor.impact !== 0)
    .map((factor) => ({
      id: `indicator-${factor.label}`,
      label: factor.label,
      source: 'indicator' as const,
      impact: factor.impact,
      direction: signedDirection(factor.impact),
      reason: `방향점수에 ${factor.impact > 0 ? '+' : ''}${factor.impact}점 반영된 선행지표입니다.`,
      relatedSymbols: [factor.label],
    }))

  const newsImpacts = newsItems
    .slice(0, 8)
    .map((item) => {
      const impact = clamp(Math.round(newsItemImpact(item) * 5), -12, 12)
      return {
        id: `news-${item.id}`,
        label: item.keyword,
        source: 'news' as const,
        impact,
        direction: item.direction,
        reason: item.title,
        relatedSymbols: item.relatedSymbols.length > 0 ? item.relatedSymbols : [item.keyword],
      }
    })
    .filter((item) => item.impact !== 0 || item.direction !== 'neutral')

  const disclosureImpacts = disclosures.slice(0, 8).map((item) => {
    const impact = disclosureImpact(item)
    return {
      id: `disclosure-${item.id}`,
      label: `${item.corpName} 공시`,
      source: 'disclosure' as const,
      impact,
      direction: signedDirection(impact),
      reason: item.reportName,
      relatedSymbols: [item.symbol, item.sector],
    }
  })

  const calendarImpacts = eventsData
    .filter((event) => isTodayCalendarEvent(event) || event.importance === 'high')
    .slice(0, 6)
    .map((event) => {
      const impact = calendarImpact(event)
      return {
        id: `calendar-${event.id}`,
        label: event.title,
        source: 'calendar' as const,
        impact,
        direction: signedDirection(impact),
        reason: event.description ?? '발표 전후 변동성 확대 가능성이 있는 일정입니다.',
        relatedSymbols: event.relatedSymbols,
      }
    })

  const portfolioImpacts = holdingsData
    .filter((holding) => holding.impact !== 'neutral' || holding.portfolioWeight >= 25)
    .map((holding) => {
      const impact = holdingImpactForForecast(holding)
      return {
        id: `portfolio-${holding.symbol}`,
        label: `${holding.name} 비중`,
        source: 'portfolio' as const,
        impact,
        direction: signedDirection(impact),
        reason: `${holding.portfolioWeight}% 비중, 당일 ${formatChange(holding.dayChange)} 흐름입니다.`,
        relatedSymbols: [holding.symbol],
      }
    })

  return [...indicatorImpacts, ...newsImpacts, ...disclosureImpacts, ...calendarImpacts, ...portfolioImpacts]
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 12)
}

function normalizeScenarioProbabilities(rawBase: number, rawUpside: number, rawDownside: number) {
  const total = rawBase + rawUpside + rawDownside
  const base = Math.round((rawBase / total) * 100)
  const upside = Math.round((rawUpside / total) * 100)
  return {
    base,
    upside,
    downside: Math.max(0, 100 - base - upside),
  }
}

function forecastConfidence({
  biasScoreData,
  quoteStatus,
  newsStatus,
  disclosureStatus,
  calendarStatus,
}: {
  biasScoreData: BiasScore
  quoteStatus: QuoteStatus
  newsStatus: NewsStatus
  disclosureStatus: DisclosureStatus
  calendarStatus: CalendarStatus
}): MarketForecast['confidence'] {
  const statusScore =
    (quoteStatus === 'ready' ? 2 : quoteStatus === 'partial' ? 1 : 0) +
    (newsStatus === 'ready' ? 1 : 0) +
    (disclosureStatus === 'ready' || disclosureStatus === 'partial' ? 1 : 0) +
    (calendarStatus === 'ready' ? 1 : 0)
  const biasScoreValue = biasScoreData.confidence === 'high' ? 2 : biasScoreData.confidence === 'medium' ? 1 : 0
  const total = statusScore + biasScoreValue

  if (total >= 5) return 'high'
  if (total >= 3) return 'medium'
  return 'low'
}

function buildMarketForecast({
  biasScoreData,
  holdingsData,
  newsItems,
  eventsData,
  disclosures,
  quoteStatus,
  newsStatus,
  disclosureStatus,
  calendarStatus,
}: {
  biasScoreData: BiasScore
  holdingsData: Holding[]
  newsItems: LiveNewsItem[]
  eventsData: CalendarEvent[]
  disclosures: DisclosureItem[]
  quoteStatus: QuoteStatus
  newsStatus: NewsStatus
  disclosureStatus: DisclosureStatus
  calendarStatus: CalendarStatus
}): MarketForecast {
  const impacts = buildForecastImpacts({ biasScoreData, holdingsData, newsItems, eventsData, disclosures })
  const positiveSum = impacts.filter((item) => item.impact > 0).reduce((sum, item) => sum + item.impact, 0)
  const negativeSum = Math.abs(impacts.filter((item) => item.impact < 0).reduce((sum, item) => sum + item.impact, 0))
  const baseScore = biasScoreData.score
  const upsideScore = clamp(Math.round(baseScore + Math.min(22, 7 + positiveSum * 0.35)), 0, 100)
  const downsideScore = clamp(Math.round(baseScore - Math.min(24, 7 + negativeSum * 0.35)), 0, 100)
  const rawUpside = Math.max(12, 36 + (baseScore - 50) * 0.45 + positiveSum * 0.18 - negativeSum * 0.12)
  const rawDownside = Math.max(12, 34 + (50 - baseScore) * 0.45 + negativeSum * 0.2 - positiveSum * 0.1)
  const rawBase = Math.max(18, 44 - Math.abs(baseScore - 50) * 0.18)
  const probabilities = normalizeScenarioProbabilities(rawBase, rawUpside, rawDownside)
  const topPositive = impacts.find((item) => item.impact > 0)
  const topRisk = impacts.find((item) => item.impact < 0)
  const openingBias =
    baseScore >= 68
      ? '상승 우위'
      : baseScore >= 58
        ? '강보합 우위'
        : baseScore >= 45
          ? '보합권 탐색'
          : baseScore >= 35
            ? '약세 압력'
            : '방어 우선'
  const expectedOpenRange =
    baseScore >= 68
      ? '+0.4% ~ +1.0%'
      : baseScore >= 58
        ? '+0.1% ~ +0.6%'
        : baseScore >= 45
          ? '-0.3% ~ +0.3%'
          : baseScore >= 35
            ? '-0.7% ~ -0.1%'
            : '-1.2% ~ -0.5%'
  const confidence = forecastConfidence({ biasScoreData, quoteStatus, newsStatus, disclosureStatus, calendarStatus })
  const checklist = [
    topPositive ? `${topPositive.label} 유지 여부` : 'NQ=F와 SOX 방향 확인',
    topRisk ? `${topRisk.label} 완화 여부` : 'USD/KRW와 VIX 급변 여부',
    '개장 30분 외국인 선물 수급',
    '삼성전자와 SK하이닉스가 지수보다 강한지 비교',
    eventsData.some((event) => isTodayCalendarEvent(event)) ? '오늘 이벤트 발표 전후 변동성 기록' : '장중 새 일정/공시 알림 확인',
  ]

  return {
    baseScore,
    openingBias,
    expectedOpenRange,
    confidence,
    summary:
      topRisk && Math.abs(topRisk.impact) >= (topPositive?.impact ?? 0)
        ? `${openingBias} 시나리오지만 ${topRisk.label}이 핵심 변수입니다.`
        : topPositive
          ? `${openingBias} 시나리오에서 ${topPositive.label}이 가장 큰 우호 근거입니다.`
          : `${openingBias} 시나리오입니다. 선행 지표 확인 후 포지션 크기를 조절합니다.`,
    scenarios: [
      {
        id: 'base',
        label: '기준 시나리오',
        score: baseScore,
        probability: probabilities.base,
        tone: baseScore >= 58 ? 'positive' : baseScore <= 43 ? 'negative' : 'neutral',
        summary: `${openingBias} 출발을 기본값으로 보고 첫 30분 수급을 확인합니다.`,
        triggers: checklist.slice(0, 3),
        action: '시초가 추격보다 선행지표와 대장주 상대강도를 먼저 확인합니다.',
      },
      {
        id: 'upside',
        label: '상방 시나리오',
        score: upsideScore,
        probability: probabilities.upside,
        tone: 'positive',
        summary: 'NQ/SOX가 유지되고 환율 부담이 줄면 반도체와 성장주 중심으로 위험선호가 이어질 수 있습니다.',
        triggers: [
          'NQ=F와 SOX 플러스권 유지',
          'USD/KRW 상승 둔화',
          topPositive ? `${topPositive.label} 후속 반응` : '보유/관심종목 거래량 동반 상승',
        ],
        action: '강한 종목만 선별하고 지수보다 약한 종목의 추격 매수는 피합니다.',
      },
      {
        id: 'downside',
        label: '하방 시나리오',
        score: downsideScore,
        probability: probabilities.downside,
        tone: 'negative',
        summary: '환율, 금리, 변동성이 같이 올라가면 기술주 갭상승 실패나 하락 출발 가능성이 커집니다.',
        triggers: [
          'USD/KRW 또는 US10Y 재상승',
          'VIX 급등이나 NQ=F 음전',
          topRisk ? `${topRisk.label} 확대` : '고중요 뉴스/공시의 부정적 가격 반응',
        ],
        action: '첫 반등 실패 전까지 현금 비중과 손절 기준을 우선 확인합니다.',
      },
    ],
    impacts,
    checklist,
  }
}

function actionPriorityVariant(priority: ActionQueueItem['priority']): 'positive' | 'negative' | 'warning' | 'neutral' | 'secondary' {
  if (priority === 'critical') return 'negative'
  if (priority === 'high') return 'warning'
  if (priority === 'medium') return 'neutral'
  return 'secondary'
}

function priorityRank(priority: ActionQueueItem['priority']) {
  if (priority === 'critical') return 4
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function makeActionItem(item: ActionQueueItem) {
  return item
}

function buildMarketActionItems(biasScoreData: BiasScore, indicators: MarketIndicator[]): ActionQueueItem[] {
  const items: ActionQueueItem[] = []
  const riskIndicators = indicators
    .filter((indicator) => indicator.direction === 'negative' && Math.abs(indicator.change) >= 0.5)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 2)

  if (biasScoreData.stance === 'pressure') {
    items.push(
      makeActionItem({
        id: 'market-pressure',
        priority: biasScoreData.score <= 35 ? 'critical' : 'high',
        category: 'market',
        title: '장 초반 방어 모드',
        summary: '선행 지표가 국내장 부담 쪽으로 기울었습니다.',
        reason: biasScoreData.summary,
        suggestedAction: '첫 30~60분은 추격 매수를 줄이고 환율, 외국인 선물, 반도체 대장주 수급을 먼저 확인합니다.',
        relatedSymbols: ['NQ=F', 'SOX', 'USD/KRW', 'US10Y'],
        evidence: `방향점수 ${biasScoreData.score}/100`,
        score: 100 - biasScoreData.score,
      }),
    )
  }

  if (biasScoreData.stance === 'favorable') {
    items.push(
      makeActionItem({
        id: 'market-risk-on',
        priority: biasScoreData.score >= 72 ? 'high' : 'medium',
        category: 'market',
        title: '우호 흐름 종목 우선 확인',
        summary: '선행 지표가 위험선호 쪽으로 기울었습니다.',
        reason: biasScoreData.summary,
        suggestedAction: '시장 전체 추격보다 보유 반도체와 관심 성장주가 지수보다 강한지 먼저 비교합니다.',
        relatedSymbols: ['SOX', 'NQ=F', '005930', '000660'],
        evidence: `방향점수 ${biasScoreData.score}/100`,
        score: biasScoreData.score,
      }),
    )
  }

  for (const indicator of riskIndicators) {
    items.push(
      makeActionItem({
        id: `indicator-${indicator.symbol}`,
        priority: Math.abs(indicator.change) >= 3 ? 'high' : 'medium',
        category: 'market',
        title: `${indicator.symbol} 부담 신호 확인`,
        summary: `${indicator.name} 흐름이 국내장에 부담입니다.`,
        reason: indicator.note,
        suggestedAction: '관련 보유종목의 시초가 갭과 첫 반등 실패 여부를 같이 봅니다.',
        relatedSymbols: [indicator.symbol],
        evidence: `${indicator.symbol} ${formatChange(indicator.change)}`,
        score: 55 + Math.min(30, Math.abs(indicator.change) * 4),
      }),
    )
  }

  return items
}

function buildPortfolioActionItems(holdingsData: Holding[]): ActionQueueItem[] {
  return holdingsData
    .filter((holding) => holding.impact === 'negative' || holding.portfolioWeight >= 30)
    .map((holding) => {
      const isLargeRisk = holding.impact === 'negative' && (holding.portfolioWeight >= 25 || holding.dayChange <= -3)

      return makeActionItem({
        id: `portfolio-${holding.symbol}`,
        priority: isLargeRisk ? 'high' : holding.portfolioWeight >= 35 ? 'medium' : 'low',
        category: 'portfolio',
        title: `${holding.name} 비중/가격 압력 점검`,
        summary: `${holding.portfolioWeight}% 비중, 당일 ${formatChange(holding.dayChange)} 흐름입니다.`,
        reason: holding.impactNote,
        suggestedAction: '평단 대비 손익과 오늘 첫 지지 구간을 확인하고, 추가 매수는 지수 방향이 확인된 뒤 판단합니다.',
        relatedSymbols: [holding.symbol],
        evidence: `비중 ${holding.portfolioWeight}%, 등락 ${formatChange(holding.dayChange)}`,
        score: Math.round(holding.portfolioWeight + Math.abs(holding.dayChange) * 6),
      })
    })
}

function buildWatchlistActionItems(watchlistData: WatchItem[]): ActionQueueItem[] {
  return watchlistData
    .filter((item) => item.status !== 'waiting' || item.distanceToBuy <= 5)
    .map((item) =>
      makeActionItem({
        id: `watchlist-${item.symbol}`,
        priority: item.status === 'alert' ? 'high' : item.status === 'near' ? 'medium' : 'low',
        category: 'watchlist',
        title: `${item.name} 관심가 접근`,
        summary: `관심가까지 ${item.distanceToBuy.toFixed(1)}% 거리입니다.`,
        reason: item.trigger,
        suggestedAction: '관심가 근처에서 바로 매수보다 뉴스/거래량/지수 방향이 같이 맞는지 확인합니다.',
        relatedSymbols: [item.symbol],
        evidence: `현재 ${formatCurrency(item.currentPrice, item.symbol.length === 6 ? 'KR' : 'US')} / 관심가 ${formatCurrency(
          item.targetBuyPrice,
          item.symbol.length === 6 ? 'KR' : 'US',
        )}`,
        score: Math.round(70 - item.distanceToBuy * 5 + (item.status === 'alert' ? 20 : 0)),
      }),
    )
}

function buildNewsActionItems(newsItems: LiveNewsItem[], holdingsData: Holding[], watchlistData: WatchItem[]): ActionQueueItem[] {
  const trackedSymbols = new Set([...holdingsData.map((holding) => holding.symbol), ...watchlistData.map((item) => item.symbol)])

  return newsItems
    .filter((item) => item.importance === 'high' || item.relatedSymbols.some((symbol) => trackedSymbols.has(symbol)))
    .slice(0, 4)
    .map((item) =>
      makeActionItem({
        id: `news-${item.id}`,
        priority: item.importance === 'high' && item.relatedSymbols.some((symbol) => trackedSymbols.has(symbol)) ? 'high' : 'medium',
        category: 'news',
        title: `${item.keyword} 뉴스 영향 확인`,
        summary: item.title,
        reason: item.expectedImpact,
        suggestedAction:
          item.direction === 'negative'
            ? '관련 종목의 갭하락과 반등 실패 여부를 먼저 확인합니다.'
            : item.direction === 'positive'
              ? '관련 종목이 지수보다 강한지 확인하고 추격 여부는 거래량으로 필터링합니다.'
              : '기사 방향이 애매하므로 가격 반응이 먼저 확인될 때까지 대기합니다.',
        relatedSymbols: item.relatedSymbols.length > 0 ? item.relatedSymbols : [item.keyword],
        evidence: `${formatNewsTime(item.publishedAt)} · ${item.source}`,
        score: 60 + (item.importance === 'high' ? 20 : 0) + Math.abs(newsItemImpact(item) * 5),
      }),
    )
}

function buildCalendarActionItems(eventsData: CalendarEvent[]): ActionQueueItem[] {
  return eventsData
    .filter((event) => isTodayCalendarEvent(event) || event.importance === 'high')
    .slice(0, 4)
    .map((event) =>
      makeActionItem({
        id: `calendar-${event.id}`,
        priority: isTodayCalendarEvent(event) && event.importance === 'high' ? 'high' : 'medium',
        category: 'calendar',
        title: `${event.title} 준비`,
        summary: `${event.date} ${event.time} 일정입니다.`,
        reason: event.description ?? '관련 종목과 지표 변동성이 커질 수 있는 일정입니다.',
        suggestedAction: event.status === 'estimated' ? '공식 일정 여부를 재확인하고 발표 전 포지션 크기를 점검합니다.' : '발표 전후 관련 지표와 보유종목 반응을 기록합니다.',
        relatedSymbols: event.relatedSymbols,
        evidence: `${event.status ? calendarStatusLabel[event.status] : '점검'} · ${event.source ?? '캘린더'}`,
        score: 58 + (event.importance === 'high' ? 18 : 0) + (isTodayCalendarEvent(event) ? 12 : 0),
      }),
    )
}

function buildDisclosureActionItems(disclosures: DisclosureItem[], holdingsData: Holding[], watchlistData: WatchItem[]): ActionQueueItem[] {
  const trackedSymbols = new Set([...holdingsData.map((holding) => holding.symbol), ...watchlistData.map((item) => item.symbol)])

  return disclosures
    .filter((item) => item.importance === 'high' || trackedSymbols.has(item.symbol))
    .slice(0, 4)
    .map((item) =>
      makeActionItem({
        id: `disclosure-${item.receiptNo || item.id}`,
        priority: item.importance === 'high' && trackedSymbols.has(item.symbol) ? 'high' : 'medium',
        category: 'disclosure',
        title: `${item.corpName} 공시 원문 확인`,
        summary: item.reportName,
        reason: item.expectedImpact,
        suggestedAction:
          item.direction === 'negative'
            ? '공시 원문에서 리스크 원인과 정정 여부를 확인하고 장 초반 가격 반응을 먼저 봅니다.'
            : item.direction === 'positive'
              ? '수치와 계약 조건을 원문에서 확인한 뒤 뉴스 확산과 거래량을 같이 봅니다.'
              : '제목만으로 방향을 단정하지 말고 원문 핵심 항목과 시장 반응을 기록합니다.',
        relatedSymbols: [item.symbol, item.sector],
        evidence: `${formatDisclosureDate(item.submittedAt)} · ${item.source}`,
        score: 62 + (item.importance === 'high' ? 20 : 0),
      }),
    )
}

function buildActionQueue({
  biasScoreData,
  holdingsData,
  watchlistData,
  indicators,
  newsItems,
  eventsData,
  disclosures,
}: {
  biasScoreData: BiasScore
  holdingsData: Holding[]
  watchlistData: WatchItem[]
  indicators: MarketIndicator[]
  newsItems: LiveNewsItem[]
  eventsData: CalendarEvent[]
  disclosures: DisclosureItem[]
}) {
  const seen = new Set<string>()
  return [
    ...buildMarketActionItems(biasScoreData, indicators),
    ...buildPortfolioActionItems(holdingsData),
    ...buildWatchlistActionItems(watchlistData),
    ...buildNewsActionItems(newsItems, holdingsData, watchlistData),
    ...buildCalendarActionItems(eventsData),
    ...buildDisclosureActionItems(disclosures, holdingsData, watchlistData),
  ]
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.score - a.score)
    .slice(0, 10)
}

function buildMarketStatusView({
  quoteMap,
  fetchedAt,
  quoteStatus,
}: {
  quoteMap: Map<string, MarketQuote>
  fetchedAt: string | null
  quoteStatus: QuoteStatus
}): MarketStatusView {
  const usdKrw = getQuote(quoteMap, 'USD/KRW')
  const vix = getQuote(quoteMap, 'VIX')
  const usSession =
    quoteStatus === 'ready'
      ? '실시간 시세 연결'
      : quoteStatus === 'partial'
        ? '일부 시세 연결'
        : quoteStatus === 'loading'
          ? '시세 업데이트 중'
          : marketStatus.usSession

  return {
    lastUpdated: formatMarketTime(fetchedAt),
    usSession,
    koreaOpenIn: getKoreaOpenText(),
    usdKrw: usdKrw ? formatIndicatorValue('USD/KRW', usdKrw.price) : marketStatus.usdKrw,
    vix: vix ? formatIndicatorValue('VIX', vix.price) : marketStatus.vix,
  }
}

function buildDashboardSnapshot({
  baseHoldings,
  baseWatchlist,
  quotes,
  fetchedAt,
  quoteStatus,
  quoteMessage,
  calendarEventsData,
  calendarStatus,
  calendarMessage,
  liveNews,
  newsStatus,
  newsMessage,
  disclosures,
  disclosureStatus,
  disclosureMessage,
  journal,
}: {
  baseHoldings: Holding[]
  baseWatchlist: WatchItem[]
  quotes: MarketQuote[]
  fetchedAt: string | null
  quoteStatus: QuoteStatus
  quoteMessage: string
  calendarEventsData: CalendarEvent[]
  calendarStatus: CalendarStatus
  calendarMessage: string
  liveNews: LiveNewsItem[]
  newsStatus: NewsStatus
  newsMessage: string
  disclosures: DisclosureItem[]
  disclosureStatus: DisclosureStatus
  disclosureMessage: string
  journal: InvestmentJournal
}): DashboardSnapshot {
  const quoteMap = quoteBySymbol(quotes)
  const liveHoldings = mergeHoldingsWithQuotes(baseHoldings, quoteMap)
  const liveWatchlist = mergeWatchlistWithQuotes(baseWatchlist, quoteMap)
  const liveIndicators = mergeIndicatorsWithQuotes(quoteMap)
  const liveBiasScore = applyNewsBiasFactor(
    buildLiveBiasScore(liveIndicators, quotes.length),
    buildNewsBiasFactor(liveNews, liveHoldings, liveWatchlist),
  )
  const forecast = buildMarketForecast({
    biasScoreData: liveBiasScore,
    holdingsData: liveHoldings,
    newsItems: liveNews,
    eventsData: calendarEventsData,
    disclosures,
    quoteStatus,
    newsStatus,
    disclosureStatus,
    calendarStatus,
  })
  const actionQueue = buildActionQueue({
    biasScoreData: liveBiasScore,
    holdingsData: liveHoldings,
    watchlistData: liveWatchlist,
    indicators: liveIndicators,
    newsItems: liveNews,
    eventsData: calendarEventsData,
    disclosures,
  })

  return {
    holdings: liveHoldings,
    watchlist: liveWatchlist,
    storedData: {
      holdings: baseHoldings,
      watchlist: baseWatchlist,
      journal,
    },
    leadingIndicators: liveIndicators,
    biasScore: liveBiasScore,
    marketStatus: buildMarketStatusView({ quoteMap, fetchedAt, quoteStatus }),
    quoteStatus,
    quoteMessage,
    liveQuoteCount: quotes.length,
    fetchedAt,
    calendarEvents: calendarEventsData,
    calendarStatus,
    calendarMessage,
    liveNews,
    newsStatus,
    newsMessage,
    disclosures,
    disclosureStatus,
    disclosureMessage,
    forecast,
    actionQueue,
    journal,
  }
}

function MetricCard({
  label,
  value,
  tone = 'neutral',
  detail,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative' | 'warning' | 'neutral'
  detail?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {detail ? (
          <Badge className="mt-3" variant={tone}>
            {detail}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ActionQueuePanel({
  items,
  title = '오늘 액션 큐',
  description = '시장, 뉴스, 일정, 보유/관심종목을 합친 우선순위',
  maxItems,
  compact = false,
}: {
  items: ActionQueueItem[]
  title?: string
  description?: string
  maxItems?: number
  compact?: boolean
}) {
  const visibleItems = typeof maxItems === 'number' ? items.slice(0, maxItems) : items

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant={items.some((item) => item.priority === 'critical') ? 'negative' : items.some((item) => item.priority === 'high') ? 'warning' : 'neutral'}>
            {items.length}개 대기
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleItems.length > 0 ? (
          visibleItems.map((item) => (
            <div key={item.id} className="rounded-md border border-border bg-muted/15 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={actionPriorityVariant(item.priority)}>{actionPriorityLabel[item.priority]}</Badge>
                <Badge variant="secondary">{actionCategoryLabel[item.category]}</Badge>
                <span className="text-xs text-muted-foreground">{item.evidence}</span>
              </div>
              <div className="text-sm font-semibold leading-6">{item.title}</div>
              <div className="mt-1 text-sm leading-6 text-foreground/85">{item.summary}</div>
              {!compact ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</div> : null}
              <div className="mt-3 rounded-md border border-border bg-background/70 p-3 text-sm leading-6">
                {item.suggestedAction}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.relatedSymbols.map((symbol) => (
                  <Badge key={symbol} variant="secondary">
                    {symbol}
                  </Badge>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-border bg-muted/15 p-4 text-sm text-muted-foreground">
            지금은 우선 처리할 액션이 없습니다.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PageGrid({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-[1600px] gap-4 p-4 md:p-6">{children}</div>
}

type HoldingFormState = {
  symbol: string
  name: string
  market: 'KR' | 'US'
  quantity: string
  averagePrice: string
}

type WatchFormState = {
  symbol: string
  name: string
  targetBuyPrice: string
  trigger: string
}

const emptyHoldingForm: HoldingFormState = {
  symbol: '',
  name: '',
  market: 'KR',
  quantity: '',
  averagePrice: '',
}

const emptyWatchForm: WatchFormState = {
  symbol: '',
  name: '',
  targetBuyPrice: '',
  trigger: '',
}

const inputClassName =
  'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary'

const textareaClassName =
  'min-h-28 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary'

function holdingToForm(holding: Holding): HoldingFormState {
  return {
    symbol: holding.symbol,
    name: holding.name,
    market: holding.market,
    quantity: String(holding.quantity),
    averagePrice: String(holding.averagePrice),
  }
}

function watchItemToForm(item: WatchItem): WatchFormState {
  return {
    symbol: item.symbol,
    name: item.name,
    targetBuyPrice: String(item.targetBuyPrice),
    trigger: item.trigger,
  }
}

function formToHolding(form: HoldingFormState, existing?: Holding): Holding {
  const symbol = normalizeUserSymbol(form.symbol)
  const market = form.market
  const averagePrice = parseNumericInput(form.averagePrice, existing?.averagePrice ?? 0)

  return {
    symbol,
    name: form.name.trim() || symbol,
    market,
    quantity: parseNumericInput(form.quantity, existing?.quantity ?? 0),
    averagePrice,
    currentPrice: existing?.currentPrice ?? averagePrice,
    dayChange: existing?.dayChange ?? 0,
    portfolioWeight: existing?.portfolioWeight ?? 0,
    impact: existing?.impact ?? 'neutral',
    impactNote: existing?.impactNote ?? '사용자가 추가한 보유종목입니다.',
  }
}

function formToWatchItem(form: WatchFormState, existing?: WatchItem): WatchItem {
  const symbol = normalizeUserSymbol(form.symbol)
  const targetBuyPrice = parseNumericInput(form.targetBuyPrice, existing?.targetBuyPrice ?? 0)

  return {
    symbol,
    name: form.name.trim() || symbol,
    targetBuyPrice,
    currentPrice: existing?.currentPrice ?? targetBuyPrice,
    distanceToBuy: existing?.distanceToBuy ?? 0,
    trigger: form.trigger.trim() || '가격과 뉴스 트리거 확인',
    status: existing?.status ?? 'waiting',
  }
}

function HoldingsPage({
  holdingsData,
  biasScoreData,
  onSaveHolding,
  onDeleteHolding,
  onResetHoldings,
}: {
  holdingsData: Holding[]
  biasScoreData: BiasScore
  onSaveHolding: (holding: Holding, previousSymbol?: string) => void
  onDeleteHolding: (symbol: string) => void
  onResetHoldings: () => void
}) {
  const [form, setForm] = useState<HoldingFormState>(emptyHoldingForm)
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null)
  const totalPositions = holdingsData.length
  const positiveCount = holdingsData.filter((holding) => holding.impact === 'positive').length
  const riskCount = holdingsData.filter((holding) => holding.impact === 'negative').length
  const topWeight = holdingsData.length > 0 ? holdingsData.reduce(
    (top, holding) => (holding.portfolioWeight > top.portfolioWeight ? holding : top),
    holdingsData[0],
  ) : null
  const isFormValid = normalizeUserSymbol(form.symbol).length > 0 && parseNumericInput(form.quantity) > 0

  function clearForm() {
    setForm(emptyHoldingForm)
    setEditingSymbol(null)
  }

  function editHolding(holding: Holding) {
    setForm(holdingToForm(holding))
    setEditingSymbol(holding.symbol)
  }

  function submitHolding() {
    if (!isFormValid) return

    const symbol = normalizeUserSymbol(form.symbol)
    const existing = holdingsData.find((holding) => holding.symbol === editingSymbol || holding.symbol === symbol)
    onSaveHolding(formToHolding(form, existing), editingSymbol ?? undefined)
    clearForm()
  }

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="보유 종목" value={`${totalPositions}개`} detail={`${positiveCount}개 우호`} tone="positive" />
        <MetricCard label="최대 비중" value={topWeight?.name ?? '-'} detail={topWeight ? `${topWeight.portfolioWeight}%` : '대기'} tone="warning" />
        <MetricCard label="이슈 부담" value={`${riskCount}개`} detail="환율/금리 확인" tone={riskCount ? 'negative' : 'neutral'} />
        <MetricCard label="국내장 방향점수" value={`+${biasScoreData.score}`} detail={`신뢰도 ${confidenceLabel[biasScoreData.confidence]}`} tone={biasScoreData.stance === 'pressure' ? 'negative' : biasScoreData.stance === 'neutral' ? 'neutral' : 'positive'} />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>보유종목 편집</CardTitle>
              <CardDescription>수량과 평단은 브라우저에 저장되고, 현재가는 실시간 시세로 덮어씁니다.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onResetHoldings}>
              <RefreshCw className="size-4" />
              기본값
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[120px_minmax(150px,1fr)_110px_120px_160px_auto]">
            <input
              className={inputClassName}
              placeholder="티커"
              value={form.symbol}
              onChange={(event) => {
                const symbol = normalizeUserSymbol(event.target.value)
                setForm((current) => ({ ...current, symbol, market: symbol ? defaultMarketForSymbol(symbol) : current.market }))
              }}
            />
            <input
              className={inputClassName}
              placeholder="종목명"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <select
              className={inputClassName}
              value={form.market}
              onChange={(event) => setForm((current) => ({ ...current, market: event.target.value as 'KR' | 'US' }))}
            >
              <option value="KR">국내</option>
              <option value="US">미국</option>
            </select>
            <input
              className={inputClassName}
              placeholder="수량"
              inputMode="decimal"
              value={form.quantity}
              onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="평단"
              inputMode="decimal"
              value={form.averagePrice}
              onChange={(event) => setForm((current) => ({ ...current, averagePrice: event.target.value }))}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" className="min-w-20" onClick={submitHolding} disabled={!isFormValid}>
                <Save className="size-4" />
                저장
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label="입력 취소" onClick={clearForm}>
                <X className="size-4" />
              </Button>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {editingSymbol ? `${editingSymbol} 수정 중` : '국내 종목은 005930처럼 6자리, 미국 종목은 AAPL처럼 입력하면 됩니다.'}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>보유종목 상세</CardTitle>
            <CardDescription>평단, 현재가, 손익, 비중, 연결 이슈</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>티커</TableHead>
                  <TableHead>종목명</TableHead>
                  <TableHead>수량</TableHead>
                  <TableHead>평단</TableHead>
                  <TableHead>현재가</TableHead>
                  <TableHead>평가손익</TableHead>
                  <TableHead>비중</TableHead>
                  <TableHead>영향</TableHead>
                  <TableHead>관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdingsData.map((holding) => {
                  const profit = holdingProfit(holding)
                  return (
                    <TableRow key={holding.symbol}>
                      <TableCell className="font-mono font-medium">{holding.symbol}</TableCell>
                      <TableCell>{holding.name}</TableCell>
                      <TableCell>{holding.quantity}</TableCell>
                      <TableCell>{formatCurrency(holding.averagePrice, holding.market)}</TableCell>
                      <TableCell>{formatCurrency(holding.currentPrice, holding.market)}</TableCell>
                      <TableCell>
                        <Badge variant={profit >= 0 ? 'positive' : 'negative'}>
                          {formatSignedCurrency(profit, holding.market)}
                        </Badge>
                      </TableCell>
                      <TableCell>{holding.portfolioWeight}%</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={directionVariant(holding.impact)}>{directionLabel[holding.impact]}</Badge>
                          <span className="text-xs text-muted-foreground">{relatedIssues(holding.symbol).length}건</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="icon" aria-label={`${holding.name} 수정`} onClick={() => editHolding(holding)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button type="button" variant="outline" size="icon" aria-label={`${holding.name} 삭제`} onClick={() => onDeleteHolding(holding.symbol)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>비중 점검</CardTitle>
            <CardDescription>집중도와 영향 요약</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {holdingsData.map((holding) => (
              <div key={holding.symbol} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">{holding.name}</div>
                    <div className="text-xs text-muted-foreground">{holding.impactNote}</div>
                  </div>
                  <Badge variant={directionVariant(holding.impact)}>{holding.portfolioWeight}%</Badge>
                </div>
                <Progress value={holding.portfolioWeight} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </PageGrid>
  )
}

function WatchlistPage({
  watchlistData,
  onSaveWatchItem,
  onDeleteWatchItem,
  onResetWatchlist,
}: {
  watchlistData: WatchItem[]
  onSaveWatchItem: (item: WatchItem, previousSymbol?: string) => void
  onDeleteWatchItem: (symbol: string) => void
  onResetWatchlist: () => void
}) {
  const [form, setForm] = useState<WatchFormState>(emptyWatchForm)
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null)
  const isFormValid = normalizeUserSymbol(form.symbol).length > 0 && parseNumericInput(form.targetBuyPrice) > 0

  function clearForm() {
    setForm(emptyWatchForm)
    setEditingSymbol(null)
  }

  function editWatchItem(item: WatchItem) {
    setForm(watchItemToForm(item))
    setEditingSymbol(item.symbol)
  }

  function submitWatchItem() {
    if (!isFormValid) return

    const symbol = normalizeUserSymbol(form.symbol)
    const existing = watchlistData.find((item) => item.symbol === editingSymbol || item.symbol === symbol)
    onSaveWatchItem(formToWatchItem(form, existing), editingSymbol ?? undefined)
    clearForm()
  }

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="관심종목" value={`${watchlistData.length}개`} detail="조건 추적" />
        <MetricCard label="매수가 근접" value={`${watchlistData.filter((item) => item.status === 'near').length}개`} detail="우선 확인" tone="positive" />
        <MetricCard label="이슈 확인" value={`${watchlistData.filter((item) => item.status === 'alert').length}개`} detail="뉴스 연결" tone="warning" />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>관심종목 편집</CardTitle>
              <CardDescription>관심가와 트리거를 저장하고 실시간 현재가와 거리 계산에 연결합니다.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onResetWatchlist}>
              <RefreshCw className="size-4" />
              기본값
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[120px_minmax(150px,1fr)_160px_minmax(220px,2fr)_auto]">
            <input
              className={inputClassName}
              placeholder="티커"
              value={form.symbol}
              onChange={(event) => setForm((current) => ({ ...current, symbol: normalizeUserSymbol(event.target.value) }))}
            />
            <input
              className={inputClassName}
              placeholder="종목명"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="관심가"
              inputMode="decimal"
              value={form.targetBuyPrice}
              onChange={(event) => setForm((current) => ({ ...current, targetBuyPrice: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="트리거"
              value={form.trigger}
              onChange={(event) => setForm((current) => ({ ...current, trigger: event.target.value }))}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" className="min-w-20" onClick={submitWatchItem} disabled={!isFormValid}>
                <Save className="size-4" />
                저장
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label="입력 취소" onClick={clearForm}>
                <X className="size-4" />
              </Button>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {editingSymbol ? `${editingSymbol} 수정 중` : '저장 후 대시보드의 관심종목 트리거 카드에도 바로 반영됩니다.'}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-3">
        {watchlistData.map((item) => (
          <Card key={item.symbol}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{item.symbol}</CardTitle>
                  <CardDescription>{item.name}</CardDescription>
                </div>
                <Badge variant={item.status === 'near' ? 'positive' : item.status === 'alert' ? 'warning' : 'neutral'}>
                  {watchStatusLabel[item.status]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="text-xs text-muted-foreground">현재가</div>
                  <div className="mt-1 font-semibold">{formatCurrency(item.currentPrice, item.symbol.length === 6 ? 'KR' : 'US')}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="text-xs text-muted-foreground">관심가</div>
                  <div className="mt-1 font-semibold">{formatCurrency(item.targetBuyPrice, item.symbol.length === 6 ? 'KR' : 'US')}</div>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">매수가까지 거리</span>
                  <span>{item.distanceToBuy.toFixed(1)}%</span>
                </div>
                <Progress value={Math.max(0, 100 - item.distanceToBuy * 6)} />
              </div>
              <div className="rounded-md border border-border bg-muted/15 p-3 text-sm">{item.trigger}</div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => editWatchItem(item)}>
                  <Pencil className="size-4" />
                  수정
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onDeleteWatchItem(item.symbol)}>
                  <Trash2 className="size-4" />
                  삭제
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </PageGrid>
  )
}

function MarketRadarPage({
  leadingIndicatorsData,
  biasScoreData,
}: {
  leadingIndicatorsData: MarketIndicator[]
  biasScoreData: BiasScore
}) {
  const indicatorChartData = buildIndicatorChartData(leadingIndicatorsData)

  return (
    <PageGrid>
      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>국내장 방향점수</CardTitle>
            <CardDescription>{biasScoreData.summary}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 text-5xl font-semibold">+{biasScoreData.score}</div>
            <Progress value={biasScoreData.score} />
            <div className="mt-4 grid gap-2">
              {[...biasScoreData.positives, ...biasScoreData.risks].map((factor) => (
                <div key={factor.label} className="flex items-center justify-between rounded-md border border-border bg-muted/15 p-3 text-sm">
                  <span>{factor.label}</span>
                  <Badge variant={factor.impact >= 0 ? 'positive' : 'negative'}>{factor.impact >= 0 ? `+${factor.impact}` : factor.impact}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>선행 지표 맵</CardTitle>
            <CardDescription>미국장, 선물, 환율, 금리의 방향성</CardDescription>
          </CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={indicatorChartData} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="symbol" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--popover-foreground)',
                  }}
                />
                <Bar dataKey="change" name="등락률" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {leadingIndicatorsData.map((indicator) => (
          <Card key={indicator.symbol}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold">{indicator.symbol}</div>
                  <div className="text-xs text-muted-foreground">{indicator.name}</div>
                </div>
                <Badge variant={directionVariant(indicator.direction)}>{formatChange(indicator.change)}</Badge>
              </div>
              <div className="text-xl font-semibold">{indicator.value}</div>
              <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                {directionIcon(indicator.direction)}
                <span>{indicator.note}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </PageGrid>
  )
}

type NewsApiResponse = {
  configured: boolean
  fetchedAt?: string
  items: LiveNewsItem[]
  message?: string
}

function formatNewsTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '시간 확인'

  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDisclosureDate(value: string) {
  if (!/^\d{8}$/.test(value)) return '접수일 확인'
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return '접수일 확인'

  return date.toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
}

function formatSavedTime(value: string | null) {
  if (!value) return '아직 저장 전'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '저장 시간 확인'

  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const forecastSourceLabel = {
  indicator: '지표',
  news: '뉴스',
  disclosure: '공시',
  calendar: '일정',
  portfolio: '보유',
}

function ForecastPage({ forecast, actionQueue }: { forecast: MarketForecast; actionQueue: ActionQueueItem[] }) {
  const topImpact = forecast.impacts[0]
  const topRisk = forecast.impacts.find((item) => item.impact < 0)
  const topPositive = forecast.impacts.find((item) => item.impact > 0)

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="기준 흐름" value={forecast.openingBias} detail={`점수 ${forecast.baseScore}/100`} tone={forecast.baseScore >= 58 ? 'positive' : forecast.baseScore <= 43 ? 'negative' : 'neutral'} />
        <MetricCard label="예상 출발 범위" value={forecast.expectedOpenRange} detail="KOSPI 기준 추정" tone={forecast.baseScore >= 58 ? 'positive' : forecast.baseScore <= 43 ? 'negative' : 'neutral'} />
        <MetricCard label="예측 신뢰도" value={confidenceLabel[forecast.confidence]} detail="데이터 연결 기준" tone={forecast.confidence === 'high' ? 'positive' : forecast.confidence === 'medium' ? 'warning' : 'neutral'} />
        <MetricCard label="핵심 변수" value={topImpact?.label ?? '확인 대기'} detail={topImpact ? `${topImpact.impact > 0 ? '+' : ''}${topImpact.impact}점` : '데이터 대기'} tone={topImpact ? directionVariant(topImpact.direction) : 'neutral'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>내일장 시나리오</CardTitle>
            <CardDescription>{forecast.summary}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-3">
            {forecast.scenarios.map((scenario) => (
              <div key={scenario.id} className="rounded-md border border-border bg-muted/15 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{scenario.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">방향점수 {scenario.score}/100</div>
                  </div>
                  <Badge variant={scenario.tone}>{scenario.probability}%</Badge>
                </div>
                <Progress value={scenario.probability} />
                <div className="mt-3 text-sm leading-6 text-foreground/85">{scenario.summary}</div>
                <div className="mt-3 space-y-2">
                  {scenario.triggers.map((trigger) => (
                    <div key={trigger} className="rounded-md border border-border bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {trigger}
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">{scenario.action}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>장전 체크리스트</CardTitle>
            <CardDescription>개장 전에 순서대로 볼 항목</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {forecast.checklist.map((item, index) => (
              <div key={item} className="flex gap-3 rounded-md border border-border bg-muted/15 p-3">
                <Badge variant="secondary">{index + 1}</Badge>
                <div className="text-sm leading-6">{item}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>영향 요인 랭킹</CardTitle>
            <CardDescription>지표, 뉴스, 공시, 일정, 포트폴리오를 같은 점수로 비교</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {forecast.impacts.length > 0 ? (
              forecast.impacts.map((impact) => (
                <div key={impact.id} className="rounded-md border border-border bg-muted/15 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={directionVariant(impact.direction)}>{impact.impact > 0 ? '+' : ''}{impact.impact}</Badge>
                    <Badge variant="secondary">{forecastSourceLabel[impact.source]}</Badge>
                    {impact.relatedSymbols.slice(0, 3).map((symbol) => (
                      <Badge key={symbol} variant="secondary">
                        {symbol}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-sm font-semibold">{impact.label}</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">{impact.reason}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-border bg-muted/15 p-4 text-sm text-muted-foreground">
                아직 예측에 반영할 실시간 영향 요인이 충분하지 않습니다.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>대응 포인트</CardTitle>
            <CardDescription>상방/하방 핵심 조건과 바로 할 일</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-positive/25 bg-positive/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-positive">
                <TrendingUp className="size-4" />
                상방 확인
              </div>
              <div className="text-sm leading-6 text-foreground/85">
                {topPositive ? `${topPositive.label}이 유지되면 강한 종목만 선별합니다.` : 'NQ=F, SOX, 환율 안정 여부를 먼저 봅니다.'}
              </div>
            </div>
            <div className="rounded-md border border-negative/25 bg-negative/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-negative">
                <TrendingDown className="size-4" />
                하방 방어
              </div>
              <div className="text-sm leading-6 text-foreground/85">
                {topRisk ? `${topRisk.label}이 확대되면 첫 반등 실패 전까지 방어적으로 봅니다.` : '환율, 금리, 변동성 급등 여부를 확인합니다.'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold">예측 기반 액션</div>
              {actionQueue.slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge variant={actionPriorityVariant(item.priority)}>{actionPriorityLabel[item.priority]}</Badge>
                    <Badge variant="secondary">{actionCategoryLabel[item.category]}</Badge>
                  </div>
                  <div className="text-sm font-medium leading-6">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.suggestedAction}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </PageGrid>
  )
}

function NewsPage({
  holdingsData,
  liveNews,
  newsStatus,
  newsMessage,
  onRefreshNews,
}: {
  holdingsData: Holding[]
  liveNews: LiveNewsItem[]
  newsStatus: NewsStatus
  newsMessage: string
  onRefreshNews: () => void
}) {
  const [activeKeyword, setActiveKeyword] = useState('전체')

  const keywordFilters = ['전체', ...newsKeywords]
  const visibleLiveNews = activeKeyword === '전체' ? liveNews : liveNews.filter((item) => item.keyword === activeKeyword)
  const hasLiveNews = liveNews.length > 0
  const highImportanceCount = hasLiveNews
    ? liveNews.filter((item) => item.importance === 'high').length
    : keyIssues.filter((issue) => issue.importance === 'high').length
  const linkedNewsCount = hasLiveNews
    ? liveNews.filter((item) => holdingsData.some((holding) => item.relatedSymbols.includes(holding.symbol))).length
    : keyIssues.filter((issue) => holdingsData.some((holding) => issue.relatedSymbols.includes(holding.symbol))).length
  const statusLabel =
    newsStatus === 'ready'
      ? '네이버 API 연결'
      : newsStatus === 'loading'
        ? '불러오는 중'
        : newsStatus === 'error'
          ? '연결 오류'
          : '모의 데이터'

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="뉴스 피드" value={`${hasLiveNews ? liveNews.length : keyIssues.length}건`} detail={statusLabel} tone={newsStatus === 'error' ? 'negative' : hasLiveNews ? 'positive' : 'neutral'} />
        <MetricCard label="높은 중요도" value={`${highImportanceCount}건`} detail="우선 확인" tone="warning" />
        <MetricCard label="보유종목 연결" value={`${linkedNewsCount}건`} detail="포트폴리오 영향" tone="positive" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>네이버 뉴스 피드</CardTitle>
                <CardDescription>키워드별 최신 뉴스와 예상 영향을 함께 표시</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onRefreshNews} disabled={newsStatus === 'loading'}>
                <RefreshCw className={cn('size-4', newsStatus === 'loading' && 'animate-spin')} />
                새로고침
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {keywordFilters.map((keyword) => (
                <Button
                  key={keyword}
                  type="button"
                  size="sm"
                  variant={activeKeyword === keyword ? 'secondary' : 'ghost'}
                  onClick={() => setActiveKeyword(keyword)}
                >
                  {keyword}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={newsStatus === 'ready' ? 'positive' : newsStatus === 'error' ? 'negative' : 'neutral'}>
                {statusLabel}
              </Badge>
              {newsMessage ? <span className="text-xs text-muted-foreground">{newsMessage}</span> : null}
            </div>

            {hasLiveNews ? (
              <div className="space-y-3">
                {(visibleLiveNews.length > 0 ? visibleLiveNews : liveNews).map((item) => (
                  <a
                    key={item.id}
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-border bg-muted/15 p-4 transition hover:border-primary/45 hover:bg-muted/25"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">{formatNewsTime(item.publishedAt)}</Badge>
                      <Badge variant={directionVariant(item.direction)}>{directionLabel[item.direction]}</Badge>
                      <Badge variant={item.importance === 'high' ? 'warning' : 'neutral'}>중요도 {importanceLabel[item.importance]}</Badge>
                      <Badge variant="secondary">{item.keyword}</Badge>
                      <Badge variant="secondary">{item.source}</Badge>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-semibold leading-6">{item.title}</div>
                      <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.description}</div>
                    <div className="mt-2 text-sm leading-6 text-foreground/85">{item.expectedImpact}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[...item.relatedSymbols, ...item.sectors].map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {keyIssues.map((issue) => (
                  <div key={issue.id} className="rounded-md border border-border bg-muted/15 p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">{issue.time}</Badge>
                      <Badge variant={directionVariant(issue.direction)}>{directionLabel[issue.direction]}</Badge>
                      <Badge variant={issue.importance === 'high' ? 'warning' : 'neutral'}>중요도 {importanceLabel[issue.importance]}</Badge>
                      <Badge variant="secondary">신뢰도 {confidenceLabel[issue.confidence]}</Badge>
                    </div>
                    <div className="text-sm font-semibold">{issue.title}</div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">{issue.expectedImpact}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[...issue.relatedSymbols, ...issue.sectors].map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>영향 분포</CardTitle>
            <CardDescription>오늘 뉴스와 이슈 방향성</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(['positive', 'negative', 'mixed'] as Direction[]).map((direction) => {
              const count = hasLiveNews
                ? liveNews.filter((item) => item.direction === direction).length
                : keyIssues.filter((issue) => issue.direction === direction).length
              const total = hasLiveNews ? liveNews.length : keyIssues.length
              return (
                <div key={direction} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>{directionLabel[direction]}</span>
                    <Badge variant={directionVariant(direction)}>{count}건</Badge>
                  </div>
                  <Progress value={total > 0 ? (count / total) * 100 : 0} />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </section>
    </PageGrid>
  )
}

function DisclosuresPage({
  disclosures,
  disclosureStatus,
  disclosureMessage,
  onRefreshDisclosures,
}: {
  disclosures: DisclosureItem[]
  disclosureStatus: DisclosureStatus
  disclosureMessage: string
  onRefreshDisclosures: () => void
}) {
  const highImportanceCount = disclosures.filter((item) => item.importance === 'high').length
  const positiveCount = disclosures.filter((item) => item.direction === 'positive').length
  const riskCount = disclosures.filter((item) => item.direction === 'negative' || item.direction === 'mixed').length
  const statusLabel =
    disclosureStatus === 'ready'
      ? 'OpenDART 연결'
      : disclosureStatus === 'partial'
        ? '일부 연결'
        : disclosureStatus === 'loading'
          ? '불러오는 중'
          : disclosureStatus === 'error'
            ? '연결 오류'
            : '설정 필요'

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="최근 공시" value={`${disclosures.length}건`} detail={statusLabel} tone={disclosureStatus === 'error' ? 'negative' : disclosures.length > 0 ? 'positive' : 'neutral'} />
        <MetricCard label="높은 중요도" value={`${highImportanceCount}건`} detail="원문 우선" tone="warning" />
        <MetricCard label="우호 가능성" value={`${positiveCount}건`} detail="수치 확인" tone="positive" />
        <MetricCard label="리스크/혼재" value={`${riskCount}건`} detail="가격 반응 확인" tone="negative" />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>DART 공시 원문</CardTitle>
              <CardDescription>보유/관심 국내 종목의 최근 공시와 예상 영향</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRefreshDisclosures} disabled={disclosureStatus === 'loading'}>
              <RefreshCw className={cn('size-4', disclosureStatus === 'loading' && 'animate-spin')} />
              새로고침
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={disclosureStatus === 'ready' ? 'positive' : disclosureStatus === 'partial' ? 'warning' : disclosureStatus === 'error' ? 'negative' : 'neutral'}>
              {statusLabel}
            </Badge>
            <span className="text-xs text-muted-foreground">{disclosureMessage}</span>
          </div>

          {disclosures.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {disclosures.map((item) => (
                <a
                  key={item.id}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border border-border bg-muted/15 p-4 transition hover:border-primary/45 hover:bg-muted/25"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">{formatDisclosureDate(item.submittedAt)}</Badge>
                    <Badge variant={directionVariant(item.direction)}>{directionLabel[item.direction]}</Badge>
                    <Badge variant={item.importance === 'high' ? 'warning' : 'neutral'}>중요도 {importanceLabel[item.importance]}</Badge>
                    <Badge variant="secondary">{item.symbol}</Badge>
                    <Badge variant="secondary">{item.source}</Badge>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold leading-6">{item.corpName}</div>
                      <div className="mt-1 text-sm leading-6 text-foreground/90">{item.reportName}</div>
                    </div>
                    <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-3 text-sm leading-6 text-muted-foreground">{item.expectedImpact}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">{item.sector}</Badge>
                    {item.note ? <Badge variant="secondary">{item.note}</Badge> : null}
                    {item.receiptNo ? <Badge variant="secondary">{item.receiptNo}</Badge> : null}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/15 p-5">
              <div className="text-sm font-medium">공시 원문 연결 대기</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                OpenDART API 키가 있으면 삼성전자, SK하이닉스, NAVER, LG에너지솔루션 같은 국내 종목의 최근 공시를 자동으로 가져옵니다.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="warning">OPENDART_API_KEY</Badge>
                <Badge variant="secondary">Vercel 환경변수</Badge>
                <Badge variant="secondary">서버 함수 전용</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageGrid>
  )
}

function CalendarPage({
  eventsData,
  calendarStatus,
  calendarMessage,
  onRefreshCalendar,
}: {
  eventsData: CalendarEvent[]
  calendarStatus: CalendarStatus
  calendarMessage: string
  onRefreshCalendar: () => void
}) {
  const todayEvents = eventsData.filter(isTodayCalendarEvent)
  const earningsEvents = eventsData.filter((event) => event.type === 'earnings')
  const macroEvents = eventsData.filter((event) => event.type !== 'earnings')
  const statusLabel =
    calendarStatus === 'ready'
      ? '캘린더 연결'
      : calendarStatus === 'loading'
        ? '불러오는 중'
        : calendarStatus === 'error'
          ? '연결 오류'
          : '기본 일정'

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="오늘 이벤트" value={`${todayEvents.length}건`} detail="장중/장후 확인" tone="warning" />
        <MetricCard label="실적 관련" value={`${earningsEvents.length}건`} detail="보유/관심 연결" tone="positive" />
        <MetricCard label="매크로/정책" value={`${macroEvents.length}건`} detail={statusLabel} tone={calendarStatus === 'error' ? 'negative' : calendarStatus === 'ready' ? 'positive' : 'neutral'} />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>이벤트 타임라인</CardTitle>
              <CardDescription>종목과 지표에 연결된 일정</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRefreshCalendar} disabled={calendarStatus === 'loading'}>
              <RefreshCw className={cn('size-4', calendarStatus === 'loading' && 'animate-spin')} />
              새로고침
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant={calendarStatus === 'ready' ? 'positive' : calendarStatus === 'error' ? 'negative' : 'neutral'}>{statusLabel}</Badge>
            <span className="text-xs text-muted-foreground">{calendarMessage}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {eventsData.map((event) => (
              <div key={event.id} className="rounded-md border border-border bg-muted/15 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">
                    {event.date} · {event.time}
                  </Badge>
                  <Badge variant={event.importance === 'high' ? 'warning' : 'neutral'}>{importanceLabel[event.importance]}</Badge>
                  <Badge variant={calendarEventStatusVariant(event)}>
                    {event.status ? calendarStatusLabel[event.status] : '점검'}
                  </Badge>
                  <Badge variant="secondary">{calendarTypeLabel[event.type]}</Badge>
                </div>
                <div className="font-medium leading-6">{event.title}</div>
                {event.description ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{event.description}</div> : null}
                {event.source ? <div className="mt-2 text-xs text-muted-foreground">출처: {event.source}</div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {event.relatedSymbols.map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageGrid>
  )
}

function AlertsPage({ actionQueue }: { actionQueue: ActionQueueItem[] }) {
  const criticalCount = actionQueue.filter((item) => item.priority === 'critical').length
  const highCount = actionQueue.filter((item) => item.priority === 'high').length
  const watchlistCount = actionQueue.filter((item) => item.category === 'watchlist').length

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="긴급 알림" value={`${criticalCount}개`} detail="즉시 확인" tone={criticalCount > 0 ? 'negative' : 'neutral'} />
        <MetricCard label="높은 우선순위" value={`${highCount}개`} detail="오늘 처리" tone={highCount > 0 ? 'warning' : 'neutral'} />
        <MetricCard label="관심가/트리거" value={`${watchlistCount}개`} detail="가격 조건" tone={watchlistCount > 0 ? 'positive' : 'neutral'} />
      </section>

      <ActionQueuePanel
        items={actionQueue}
        title="알림 센터"
        description="실시간 지표, 보유비중, 뉴스, 캘린더 이벤트를 합쳐 정렬"
      />
    </PageGrid>
  )
}

function JournalActionChecklist({
  actionQueue,
  journal,
  onToggleAction,
}: {
  actionQueue: ActionQueueItem[]
  journal: InvestmentJournal
  onToggleAction: (actionId: string) => void
}) {
  const completedIds = new Set(journal.completedActionIds)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>오늘 체크리스트</CardTitle>
            <CardDescription>액션 큐를 처리하면서 완료 표시</CardDescription>
          </div>
          <Badge variant="neutral">
            {journal.completedActionIds.length}/{actionQueue.length} 완료
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {actionQueue.length > 0 ? (
          actionQueue.map((item) => {
            const checked = completedIds.has(item.id)

            return (
              <label
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/15 p-3 transition hover:border-primary/45',
                  checked && 'bg-positive/10',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={checked}
                  onChange={() => onToggleAction(item.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={actionPriorityVariant(item.priority)}>{actionPriorityLabel[item.priority]}</Badge>
                    <Badge variant="secondary">{actionCategoryLabel[item.category]}</Badge>
                    <span className="text-xs text-muted-foreground">{item.evidence}</span>
                  </span>
                  <span className={cn('block text-sm font-semibold leading-6', checked && 'text-muted-foreground line-through')}>
                    {item.title}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">{item.suggestedAction}</span>
                </span>
              </label>
            )
          })
        ) : (
          <div className="rounded-md border border-border bg-muted/15 p-4 text-sm text-muted-foreground">
            오늘 체크할 액션이 없습니다.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function NotesPage({
  actionQueue,
  journal,
  biasScoreData,
  marketStatusData,
  onUpdateJournal,
  onToggleJournalAction,
  onResetJournal,
}: {
  actionQueue: ActionQueueItem[]
  journal: InvestmentJournal
  biasScoreData: BiasScore
  marketStatusData: MarketStatusView
  onUpdateJournal: (patch: Partial<InvestmentJournal>) => void
  onToggleJournalAction: (actionId: string) => void
  onResetJournal: () => void
}) {
  const completedCount = journal.completedActionIds.filter((id) => actionQueue.some((item) => item.id === id)).length

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="저널 날짜" value={journal.date.slice(5).replace('-', '.')} detail="오늘 기록" />
        <MetricCard label="액션 완료" value={`${completedCount}/${actionQueue.length}`} detail="체크리스트" tone={completedCount > 0 ? 'positive' : 'neutral'} />
        <MetricCard label="방향점수" value={`+${biasScoreData.score}`} detail={`신뢰도 ${confidenceLabel[biasScoreData.confidence]}`} tone={biasScoreData.stance === 'pressure' ? 'negative' : biasScoreData.stance === 'neutral' ? 'neutral' : 'positive'} />
        <MetricCard label="마지막 저장" value={formatSavedTime(journal.lastSavedAt)} detail="브라우저 저장" />
      </section>

      <ActionQueuePanel
        items={actionQueue}
        title="장 시작 전 실행 순서"
        description="투자노트에 기록하기 전 먼저 볼 항목"
        maxItems={5}
        compact
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>오늘 투자 저널</CardTitle>
                <CardDescription>장전 계획과 장후 리뷰를 저장</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onResetJournal}>
                <RefreshCw className="size-4" />
                오늘 기록 초기화
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-sm font-medium">장전 계획</label>
                <Badge variant="secondary">
                  <Save className="mr-1 size-3" />
                  자동 저장
                </Badge>
              </div>
              <textarea
                className={textareaClassName}
                placeholder="예: 반도체는 첫 30분 수급 확인, 환율 급등 시 추격 매수 보류"
                value={journal.preMarketPlan}
                onChange={(event) => onUpdateJournal({ preMarketPlan: event.target.value })}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">리스크 대응</label>
              <textarea
                className={textareaClassName}
                placeholder="예: NQ/SOX 동반 약세면 보유 비중 큰 종목은 추가 매수 금지, 손절/분할 기준 기록"
                value={journal.riskPlan}
                onChange={(event) => onUpdateJournal({ riskPlan: event.target.value })}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">장후 리뷰</label>
              <textarea
                className={textareaClassName}
                placeholder="예: 방향점수와 실제 시장 폭이 맞았는지, 놓친 뉴스/지표가 있었는지 기록"
                value={journal.afterMarketReview}
                onChange={(event) => onUpdateJournal({ afterMarketReview: event.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>오늘 시장 스냅샷</CardTitle>
            <CardDescription>저널 작성 기준 상태</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">업데이트</div>
              <div className="mt-1 font-medium">{marketStatusData.lastUpdated}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">USD/KRW</div>
              <div className="mt-1 font-medium">{marketStatusData.usdKrw}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">VIX</div>
              <div className="mt-1 font-medium">{marketStatusData.vix}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">요약</div>
              <div className="mt-1 text-sm leading-6">{biasScoreData.summary}</div>
            </div>
          </CardContent>
        </Card>
      </section>

      <JournalActionChecklist
        actionQueue={actionQueue}
        journal={journal}
        onToggleAction={onToggleJournalAction}
      />

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>상승 시나리오</CardTitle>
            <CardDescription>우호적 흐름일 때 우선순위</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-7 text-foreground/85">{actionMemo.bullishScenario}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>하락 시나리오</CardTitle>
            <CardDescription>부담 흐름일 때 대응</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-7 text-foreground/85">{actionMemo.bearishScenario}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>장 시작 전 체크</CardTitle>
            <CardDescription>오늘 확인할 지표</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {actionMemo.watchBeforeOpen.map((item) => (
              <Badge key={item} variant="neutral">
                {item}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>장 후 리뷰</CardTitle>
          <CardDescription>방향점수와 실제 시장 흐름 비교</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border bg-muted/15 p-4 text-sm leading-7 text-muted-foreground">
            {actionMemo.afterMarketReview}
          </div>
        </CardContent>
      </Card>
    </PageGrid>
  )
}

function SettingsPage({
  holdingsData,
  watchlistData,
  leadingIndicatorsData,
  quoteStatus,
  quoteMessage,
  liveQuoteCount,
  fetchedAt,
  calendarStatus,
  calendarMessage,
  calendarEventCount,
  newsStatus,
  newsMessage,
  liveNewsCount,
  disclosureStatus,
  disclosureMessage,
  disclosureCount,
  backupData,
  onImportDashboardData,
  onResetDashboardData,
}: {
  holdingsData: Holding[]
  watchlistData: WatchItem[]
  leadingIndicatorsData: MarketIndicator[]
  quoteStatus: QuoteStatus
  quoteMessage: string
  liveQuoteCount: number
  fetchedAt: string | null
  calendarStatus: CalendarStatus
  calendarMessage: string
  calendarEventCount: number
  newsStatus: NewsStatus
  newsMessage: string
  liveNewsCount: number
  disclosureStatus: DisclosureStatus
  disclosureMessage: string
  disclosureCount: number
  backupData: StoredDashboardData
  onImportDashboardData: (data: StoredDashboardData) => void
  onResetDashboardData: () => void
}) {
  const [backupText, setBackupText] = useState('')
  const [backupMessage, setBackupMessage] = useState('현재 브라우저에 저장된 개인 데이터를 백업하거나 복원할 수 있습니다.')
  const [backupTone, setBackupTone] = useState<'positive' | 'negative' | 'neutral'>('neutral')
  const [healthResponse, setHealthResponse] = useState<HealthApiResponse | null>(null)
  const [healthStatus, setHealthStatus] = useState<DataHealthStatus>('idle')
  const [healthMessage, setHealthMessage] = useState('서버 진단 대기')
  const sources = [
    { name: '네이버 뉴스 API', cost: '무료 시작', priority: '우선' },
    { name: 'Yahoo Finance chart', cost: '무료 시작', priority: '우선' },
    { name: 'OpenDART', cost: '무료 시작', priority: '우선' },
    { name: '증권사 Open API', cost: '계좌 연동', priority: '우선' },
    { name: 'FMP / Finnhub / Polygon', cost: '유료 후보', priority: '후순위' },
    { name: 'AI 이슈 요약', cost: '사용량 기반', priority: '후순위' },
  ]
  const backupStats = [
    { label: '보유종목', value: `${backupData.holdings.length}개` },
    { label: '관심종목', value: `${backupData.watchlist.length}개` },
    { label: '투자노트', value: backupData.journal.date },
  ]
  const backupMessageVariant = backupTone === 'positive' ? 'positive' : backupTone === 'negative' ? 'negative' : 'neutral'
  const runtimeSources = [
    {
      id: 'runtime-quotes',
      name: '현재 시세/지수',
      status: quoteStatus as DataHealthStatus,
      source: '대시보드 수신 상태',
      metric: `${liveQuoteCount}개`,
      summary: quoteMessage,
      detail: fetchedAt ? `마지막 수신 ${formatMarketTime(fetchedAt)}` : '아직 수신 전',
      coverage: ['보유종목', '관심종목', '선행지표'],
    },
    {
      id: 'runtime-news',
      name: '현재 뉴스 피드',
      status: newsStatus as DataHealthStatus,
      source: '네이버 뉴스 수신 상태',
      metric: `${liveNewsCount}건`,
      summary: newsMessage,
      detail: liveNewsCount > 0 ? '실제 뉴스 기반 영향도 반영 중' : '뉴스가 없으면 기본 이슈 카드로 대체',
      coverage: ['키워드 뉴스', '영향도 분류', '액션 큐'],
    },
    {
      id: 'runtime-calendar',
      name: '현재 캘린더',
      status: calendarStatus as DataHealthStatus,
      source: '이벤트 캘린더 수신 상태',
      metric: `${calendarEventCount}개`,
      summary: calendarMessage,
      detail: '장전 점검과 이벤트가 액션 큐에 반영됩니다.',
      coverage: ['매크로', '정책', '실적 구간'],
    },
    {
      id: 'runtime-disclosures',
      name: '현재 공시 원문',
      status: disclosureStatus as DataHealthStatus,
      source: 'OpenDART 수신 상태',
      metric: `${disclosureCount}건`,
      summary: disclosureMessage,
      detail: disclosureCount > 0 ? '공시 원문 기반 액션 큐 반영 중' : 'OPENDART_API_KEY가 없거나 최근 공시가 없습니다.',
      coverage: ['DART 공시', '잠정실적', '주요사항보고'],
    },
  ]

  const loadHealth = useCallback(async (signal?: AbortSignal) => {
    setHealthStatus('loading')

    try {
      const response = await fetch('/api/health', { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        throw new Error('서버 진단 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as HealthApiResponse

      if (!response.ok) {
        setHealthStatus('error')
        setHealthMessage(payload.message ?? '서버 진단 API 호출에 실패했습니다.')
        return
      }

      setHealthResponse(payload)
      setHealthStatus(payload.status)
      setHealthMessage(payload.message ?? '실데이터 연결 상태를 확인했습니다.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setHealthResponse(null)
      setHealthStatus('error')
      setHealthMessage(error instanceof Error ? error.message : '서버 진단을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadHealth(controller.signal)

    return () => {
      controller.abort()
    }
  }, [loadHealth])

  const handleBuildBackup = () => {
    setBackupText(formatDashboardBackup(backupData))
    setBackupTone('positive')
    setBackupMessage('현재 저장 데이터를 JSON으로 만들었습니다.')
  }

  const handleDownloadBackup = () => {
    downloadDashboardBackup(backupData)
    setBackupTone('positive')
    setBackupMessage('백업 파일 다운로드를 시작했습니다.')
  }

  const handleImportBackup = () => {
    const result = parseDashboardBackup(backupText)
    if (!result.ok) {
      setBackupTone('negative')
      setBackupMessage(result.message)
      return
    }

    onImportDashboardData(result.data)
    setBackupText(formatDashboardBackup(result.data))
    setBackupTone('positive')
    setBackupMessage(result.message)
  }

  const handleResetDashboard = () => {
    const resetData = {
      holdings,
      watchlist,
      journal: createDefaultJournal(),
    }
    onResetDashboardData()
    setBackupText(formatDashboardBackup(resetData))
    setBackupTone('positive')
    setBackupMessage('기본 보유/관심종목과 오늘 투자노트로 복원했습니다.')
  }

  return (
    <PageGrid>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>실데이터 수신 상태</CardTitle>
            <CardDescription>지금 화면이 실제로 받은 시세, 뉴스, 캘린더 상태</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runtimeSources.map((source) => (
              <div key={source.id} className="rounded-md border border-border bg-muted/15 p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold">{source.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{source.source}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={dataHealthVariant(source.status)}>{dataHealthStatusLabel[source.status]}</Badge>
                    <Badge variant="secondary">{source.metric}</Badge>
                  </div>
                </div>
                <div className="text-sm leading-6 text-foreground/85">{source.summary}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{source.detail}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {source.coverage.map((item) => (
                    <Badge key={item} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>서버 연결 진단</CardTitle>
                <CardDescription>Vercel 함수와 환경변수 준비 상태</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadHealth()} disabled={healthStatus === 'loading'}>
                <RefreshCw className={cn('size-4', healthStatus === 'loading' && 'animate-spin')} />
                진단
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={dataHealthVariant(healthStatus)}>{dataHealthStatusLabel[healthStatus]}</Badge>
              {healthResponse?.environment ? <Badge variant="secondary">{healthResponse.environment}</Badge> : null}
            </div>
            <div className="text-sm leading-6 text-muted-foreground">{healthMessage}</div>
            {healthResponse?.services.map((service) => (
              <div key={service.id} className="rounded-md border border-border bg-muted/15 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{service.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{service.source}</div>
                  </div>
                  <Badge variant={dataHealthVariant(service.status)}>{dataHealthStatusLabel[service.status]}</Badge>
                </div>
                <div className="mt-3 text-xs leading-5 text-foreground/80">{service.summary}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{service.nextAction}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">{service.cadence}</Badge>
                  {service.coverage.slice(0, 3).map((item) => (
                    <Badge key={item} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>추적 대상</CardTitle>
            <CardDescription>보유/관심종목과 선행 지표</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 text-xs text-muted-foreground">보유종목</div>
              <div className="flex flex-wrap gap-2">
                {holdingsData.map((holding) => (
                  <Badge key={holding.symbol} variant="secondary">
                    {holding.symbol}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs text-muted-foreground">관심종목</div>
              <div className="flex flex-wrap gap-2">
                {watchlistData.map((item) => (
                  <Badge key={item.symbol} variant="secondary">
                    {item.symbol}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs text-muted-foreground">선행 지표</div>
              <div className="flex flex-wrap gap-2">
                {leadingIndicatorsData.map((indicator) => (
                  <Badge key={indicator.symbol} variant="neutral">
                    {indicator.symbol}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs text-muted-foreground">뉴스 키워드</div>
              <div className="flex flex-wrap gap-2">
                {newsKeywords.map((keyword) => (
                  <Badge key={keyword} variant="secondary">
                    {keyword}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>데이터 파이프라인</CardTitle>
            <CardDescription>다음 백엔드 단계에서 연결할 소스</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sources.map((source) => (
              <div key={source.name} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/15 p-3">
                <div>
                  <div className="text-sm">{source.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{source.cost}</div>
                </div>
                <Badge variant={source.priority === '우선' ? 'warning' : 'neutral'}>{source.priority}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>데이터 백업</CardTitle>
                <CardDescription>보유종목, 관심종목, 투자노트를 JSON 파일로 보관</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleDownloadBackup}>
                  <Download className="size-4" />
                  다운로드
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={handleBuildBackup}>
                  <Save className="size-4" />
                  JSON 만들기
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant={backupMessageVariant}>{backupMessage}</Badge>
            <textarea
              value={backupText}
              onChange={(event) => setBackupText(event.target.value)}
              placeholder="백업 JSON을 붙여넣으면 가져올 수 있습니다."
              className="min-h-56 w-full resize-y rounded-md border border-border bg-background px-3 py-3 font-mono text-xs leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleImportBackup} disabled={!backupText.trim()}>
                <Upload className="size-4" />
                가져오기
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-negative/40 text-negative hover:bg-negative/10 hover:text-negative"
                onClick={handleResetDashboard}
              >
                <RefreshCw className="size-4" />
                전체 기본값 복원
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>현재 저장 상태</CardTitle>
            <CardDescription>이 브라우저에 저장되는 개인 데이터</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {backupStats.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md border border-border bg-muted/15 p-3">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <Badge variant="secondary">{item.value}</Badge>
              </div>
            ))}
            <div className="rounded-md border border-border bg-muted/15 p-3 text-xs leading-5 text-muted-foreground">
              현재 버전은 브라우저 저장소 기반입니다. 다른 기기에서 이어 쓰려면 백업 파일을 가져오거나, 다음 단계에서 서버 저장소를 붙이면 됩니다.
            </div>
          </CardContent>
        </Card>
      </section>
    </PageGrid>
  )
}

type DashboardActions = {
  onSaveHolding: (holding: Holding, previousSymbol?: string) => void
  onDeleteHolding: (symbol: string) => void
  onResetHoldings: () => void
  onSaveWatchItem: (item: WatchItem, previousSymbol?: string) => void
  onDeleteWatchItem: (symbol: string) => void
  onResetWatchlist: () => void
  onRefreshNews: () => void
  onRefreshDisclosures: () => void
  onRefreshCalendar: () => void
  onUpdateJournal: (patch: Partial<InvestmentJournal>) => void
  onToggleJournalAction: (actionId: string) => void
  onResetJournal: () => void
  onImportDashboardData: (data: StoredDashboardData) => void
  onResetDashboardData: () => void
}

function renderPage(page: PageId, snapshot: DashboardSnapshot, actions: DashboardActions) {
  if (page === 'holdings') {
    return (
      <HoldingsPage
        holdingsData={snapshot.holdings}
        biasScoreData={snapshot.biasScore}
        onSaveHolding={actions.onSaveHolding}
        onDeleteHolding={actions.onDeleteHolding}
        onResetHoldings={actions.onResetHoldings}
      />
    )
  }
  if (page === 'watchlist') {
    return (
      <WatchlistPage
        watchlistData={snapshot.watchlist}
        onSaveWatchItem={actions.onSaveWatchItem}
        onDeleteWatchItem={actions.onDeleteWatchItem}
        onResetWatchlist={actions.onResetWatchlist}
      />
    )
  }
  if (page === 'radar') return <MarketRadarPage leadingIndicatorsData={snapshot.leadingIndicators} biasScoreData={snapshot.biasScore} />
  if (page === 'forecast') return <ForecastPage forecast={snapshot.forecast} actionQueue={snapshot.actionQueue} />
  if (page === 'news') {
    return (
      <NewsPage
        holdingsData={snapshot.holdings}
        liveNews={snapshot.liveNews}
        newsStatus={snapshot.newsStatus}
        newsMessage={snapshot.newsMessage}
        onRefreshNews={actions.onRefreshNews}
      />
    )
  }
  if (page === 'disclosures') {
    return (
      <DisclosuresPage
        disclosures={snapshot.disclosures}
        disclosureStatus={snapshot.disclosureStatus}
        disclosureMessage={snapshot.disclosureMessage}
        onRefreshDisclosures={actions.onRefreshDisclosures}
      />
    )
  }
  if (page === 'calendar') {
    return (
      <CalendarPage
        eventsData={snapshot.calendarEvents}
        calendarStatus={snapshot.calendarStatus}
        calendarMessage={snapshot.calendarMessage}
        onRefreshCalendar={actions.onRefreshCalendar}
      />
    )
  }
  if (page === 'alerts') return <AlertsPage actionQueue={snapshot.actionQueue} />
  if (page === 'notes') {
    return (
      <NotesPage
        actionQueue={snapshot.actionQueue}
        journal={snapshot.journal}
        biasScoreData={snapshot.biasScore}
        marketStatusData={snapshot.marketStatus}
        onUpdateJournal={actions.onUpdateJournal}
        onToggleJournalAction={actions.onToggleJournalAction}
        onResetJournal={actions.onResetJournal}
      />
    )
  }
  if (page === 'settings') {
    return (
      <SettingsPage
        holdingsData={snapshot.holdings}
        watchlistData={snapshot.watchlist}
        leadingIndicatorsData={snapshot.leadingIndicators}
        quoteStatus={snapshot.quoteStatus}
        quoteMessage={snapshot.quoteMessage}
        liveQuoteCount={snapshot.liveQuoteCount}
        fetchedAt={snapshot.fetchedAt}
        calendarStatus={snapshot.calendarStatus}
        calendarMessage={snapshot.calendarMessage}
        calendarEventCount={snapshot.calendarEvents.length}
        newsStatus={snapshot.newsStatus}
        newsMessage={snapshot.newsMessage}
        liveNewsCount={snapshot.liveNews.length}
        disclosureStatus={snapshot.disclosureStatus}
        disclosureMessage={snapshot.disclosureMessage}
        disclosureCount={snapshot.disclosures.length}
        backupData={snapshot.storedData}
        onImportDashboardData={actions.onImportDashboardData}
        onResetDashboardData={actions.onResetDashboardData}
      />
    )
  }
  return null
}

export function Dashboard() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [userHoldings, setUserHoldings] = useState<Holding[]>(holdings)
  const [userWatchlist, setUserWatchlist] = useState<WatchItem[]>(watchlist)
  const [journal, setJournal] = useState<InvestmentJournal>(() => createDefaultJournal())
  const [storageLoaded, setStorageLoaded] = useState(false)
  const [quoteResponse, setQuoteResponse] = useState<QuotesApiResponse | null>(null)
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>('idle')
  const [quoteMessage, setQuoteMessage] = useState('시세 연결 대기')
  const [calendarResponse, setCalendarResponse] = useState<CalendarApiResponse | null>(null)
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>('idle')
  const [calendarMessage, setCalendarMessage] = useState('캘린더 연결 대기')
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>([])
  const [newsStatus, setNewsStatus] = useState<NewsStatus>('idle')
  const [newsMessage, setNewsMessage] = useState('뉴스 연결 대기')
  const [disclosureResponse, setDisclosureResponse] = useState<DisclosureApiResponse | null>(null)
  const [disclosureStatus, setDisclosureStatus] = useState<DisclosureStatus>('idle')
  const [disclosureMessage, setDisclosureMessage] = useState('공시 연결 대기')
  const currentPage = navItems.find((item) => item.id === activePage) ?? navItems[0]
  const trackedQuoteSymbols = useMemo(
    () =>
      Array.from(
        new Set([
          ...userHoldings.map((holding) => holding.symbol),
          ...userWatchlist.map((item) => item.symbol),
          ...indicatorSymbols,
        ]),
      ),
    [userHoldings, userWatchlist],
  )
  const loadQuotes = useCallback(async (signal?: AbortSignal) => {
    setQuoteStatus((status) => (status === 'idle' ? 'loading' : status))

    try {
      const params = new URLSearchParams({
        symbols: trackedQuoteSymbols.join(','),
      })
      const response = await fetch(`/api/quotes?${params.toString()}`, { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        throw new Error('시세 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as QuotesApiResponse

      if (!response.ok) {
        setQuoteStatus('error')
        setQuoteMessage(payload.message ?? '시세 API 호출에 실패했습니다.')
        return
      }

      setQuoteResponse(payload)
      setQuoteStatus(payload.status)
      setQuoteMessage(
        payload.message ??
          (payload.quotes.length > 0 ? `${payload.quotes.length}개 시세 연결` : '시세 소스가 응답하지 않아 샘플 데이터를 표시합니다.'),
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setQuoteStatus('error')
      setQuoteMessage(error instanceof Error ? error.message : '시세를 불러오지 못했습니다.')
    }
  }, [trackedQuoteSymbols])
  const loadCalendar = useCallback(async (signal?: AbortSignal) => {
    setCalendarStatus((status) => (status === 'idle' ? 'loading' : status))

    try {
      const params = new URLSearchParams({
        symbols: trackedQuoteSymbols.join(','),
        days: '21',
      })
      const response = await fetch(`/api/calendar?${params.toString()}`, { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        throw new Error('캘린더 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as CalendarApiResponse

      if (!response.ok) {
        setCalendarStatus('error')
        setCalendarMessage(payload.message ?? '캘린더 API 호출에 실패했습니다.')
        return
      }

      setCalendarResponse(payload)
      setCalendarStatus(payload.events.length > 0 ? payload.status : 'fallback')
      setCalendarMessage(payload.message ?? (payload.events.length > 0 ? `${payload.events.length}개 이벤트 연결` : '기본 일정으로 표시합니다.'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setCalendarStatus('error')
      setCalendarMessage(error instanceof Error ? error.message : '캘린더를 불러오지 못했습니다.')
    }
  }, [trackedQuoteSymbols])
  const loadLiveNews = useCallback(async (signal?: AbortSignal) => {
    setNewsStatus((status) => (status === 'idle' ? 'loading' : status))

    try {
      const params = new URLSearchParams({
        keywords: newsKeywords.join(','),
        display: '3',
      })
      const response = await fetch(`/api/news?${params.toString()}`, { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        throw new Error('네이버 뉴스 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as NewsApiResponse

      if (!response.ok) {
        setLiveNews(payload.items ?? [])
        setNewsStatus('error')
        setNewsMessage(payload.message ?? '네이버 뉴스 API 호출에 실패했습니다.')
        return
      }

      if (!payload.configured) {
        setLiveNews([])
        setNewsStatus('fallback')
        setNewsMessage(payload.message ?? '네이버 뉴스 API 환경변수 설정이 필요합니다.')
        return
      }

      setLiveNews(payload.items)
      setNewsStatus(payload.items.length > 0 ? 'ready' : 'fallback')
      setNewsMessage(payload.items.length > 0 ? `최근 수집 ${formatNewsTime(payload.fetchedAt ?? '')}` : '수집된 뉴스가 없습니다.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setLiveNews([])
      setNewsStatus('error')
      setNewsMessage(error instanceof Error ? error.message : '뉴스를 불러오지 못했습니다.')
    }
  }, [])
  const loadDisclosures = useCallback(async (signal?: AbortSignal) => {
    setDisclosureStatus((status) => (status === 'idle' ? 'loading' : status))

    try {
      const domesticSymbols = trackedQuoteSymbols.filter((symbol) => /^\d{6}$/.test(symbol))
      const params = new URLSearchParams({
        symbols: domesticSymbols.join(','),
        days: '30',
      })
      const response = await fetch(`/api/disclosures?${params.toString()}`, { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        throw new Error('OpenDART 공시 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as DisclosureApiResponse

      if (!response.ok) {
        setDisclosureStatus('error')
        setDisclosureMessage(payload.message ?? 'OpenDART 공시 API 호출에 실패했습니다.')
        return
      }

      if (!payload.configured) {
        setDisclosureResponse(payload)
        setDisclosureStatus('fallback')
        setDisclosureMessage(payload.message ?? 'OpenDART API 환경변수 설정이 필요합니다.')
        return
      }

      setDisclosureResponse(payload)
      setDisclosureStatus(payload.items.length > 0 ? payload.status : 'fallback')
      setDisclosureMessage(payload.message ?? (payload.items.length > 0 ? `${payload.items.length}개 공시 연결` : '최근 공시가 없습니다.'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setDisclosureStatus('error')
      setDisclosureMessage(error instanceof Error ? error.message : '공시를 불러오지 못했습니다.')
    }
  }, [trackedQuoteSymbols])

  useEffect(() => {
    const stored = loadStoredDashboardData()
    if (stored) {
      setUserHoldings(stored.holdings)
      setUserWatchlist(stored.watchlist)
      setJournal(stored.journal)
    }
    setStorageLoaded(true)
  }, [])

  useEffect(() => {
    if (!storageLoaded) return
    saveStoredDashboardData({
      holdings: userHoldings,
      watchlist: userWatchlist,
      journal,
    })
  }, [journal, storageLoaded, userHoldings, userWatchlist])

  useEffect(() => {
    const controller = new AbortController()
    void loadQuotes(controller.signal)
    const intervalId = window.setInterval(() => {
      void loadQuotes()
    }, 120_000)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [loadQuotes])

  useEffect(() => {
    const controller = new AbortController()
    void loadCalendar(controller.signal)
    const intervalId = window.setInterval(() => {
      void loadCalendar()
    }, 3_600_000)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [loadCalendar])

  useEffect(() => {
    const controller = new AbortController()
    void loadLiveNews(controller.signal)
    const intervalId = window.setInterval(() => {
      void loadLiveNews()
    }, 600_000)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [loadLiveNews])

  useEffect(() => {
    const controller = new AbortController()
    void loadDisclosures(controller.signal)
    const intervalId = window.setInterval(() => {
      void loadDisclosures()
    }, 900_000)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [loadDisclosures])

  const snapshot = useMemo(
    () =>
      buildDashboardSnapshot({
        quotes: quoteResponse?.quotes ?? [],
        baseHoldings: userHoldings,
        baseWatchlist: userWatchlist,
        fetchedAt: quoteResponse?.fetchedAt ?? null,
        quoteStatus,
        quoteMessage,
        calendarEventsData: calendarResponse?.events.length ? calendarResponse.events : fallbackCalendarEvents,
        calendarStatus,
        calendarMessage,
        liveNews,
        newsStatus,
        newsMessage,
        disclosures: disclosureResponse?.items ?? [],
        disclosureStatus,
        disclosureMessage,
        journal,
      }),
    [
      calendarMessage,
      calendarResponse,
      calendarStatus,
      disclosureMessage,
      disclosureResponse,
      disclosureStatus,
      liveNews,
      journal,
      newsMessage,
      newsStatus,
      quoteMessage,
      quoteResponse,
      quoteStatus,
      userHoldings,
      userWatchlist,
    ],
  )
  const indicatorChartData = buildIndicatorChartData(snapshot.leadingIndicators)
  const biasTimeline = buildBiasTimeline(snapshot.biasScore.score)
  const dashboardIssues = snapshot.liveNews.length > 0 ? snapshot.liveNews.slice(0, 3) : keyIssues
  const quoteStatusVariant: 'positive' | 'negative' | 'warning' | 'neutral' =
    snapshot.quoteStatus === 'ready'
      ? 'positive'
      : snapshot.quoteStatus === 'partial'
        ? 'warning'
        : snapshot.quoteStatus === 'error'
          ? 'negative'
          : 'neutral'
  const actions = useMemo<DashboardActions>(
    () => ({
      onSaveHolding: (holding, previousSymbol) => {
        setUserHoldings((current) => {
          const previous = previousSymbol ? normalizeUserSymbol(previousSymbol) : holding.symbol
          const remaining = current.filter((item) => item.symbol !== previous && item.symbol !== holding.symbol)
          return [...remaining, holding]
        })
      },
      onDeleteHolding: (symbol) => {
        setUserHoldings((current) => current.filter((holding) => holding.symbol !== symbol))
      },
      onResetHoldings: () => {
        setUserHoldings(holdings)
        resetStoredDashboardData()
      },
      onSaveWatchItem: (item, previousSymbol) => {
        setUserWatchlist((current) => {
          const previous = previousSymbol ? normalizeUserSymbol(previousSymbol) : item.symbol
          const remaining = current.filter((watchItem) => watchItem.symbol !== previous && watchItem.symbol !== item.symbol)
          return [...remaining, item]
        })
      },
      onDeleteWatchItem: (symbol) => {
        setUserWatchlist((current) => current.filter((item) => item.symbol !== symbol))
      },
      onResetWatchlist: () => {
        setUserWatchlist(watchlist)
        resetStoredDashboardData()
      },
      onRefreshNews: () => {
        void loadLiveNews()
      },
      onRefreshDisclosures: () => {
        void loadDisclosures()
      },
      onRefreshCalendar: () => {
        void loadCalendar()
      },
      onUpdateJournal: (patch) => {
        setJournal((current) => ({
          ...normalizeJournal(current),
          ...patch,
          lastSavedAt: new Date().toISOString(),
        }))
      },
      onToggleJournalAction: (actionId) => {
        setJournal((current) => {
          const normalized = normalizeJournal(current)
          const completed = new Set(normalized.completedActionIds)
          if (completed.has(actionId)) {
            completed.delete(actionId)
          } else {
            completed.add(actionId)
          }

          return {
            ...normalized,
            completedActionIds: Array.from(completed),
            lastSavedAt: new Date().toISOString(),
          }
        })
      },
      onResetJournal: () => {
        setJournal({
          ...createDefaultJournal(),
          lastSavedAt: new Date().toISOString(),
        })
      },
      onImportDashboardData: (data) => {
        setUserHoldings(data.holdings)
        setUserWatchlist(data.watchlist)
        setJournal(data.journal)
        saveStoredDashboardData(data)
      },
      onResetDashboardData: () => {
        const nextJournal = createDefaultJournal()
        setUserHoldings(holdings)
        setUserWatchlist(watchlist)
        setJournal(nextJournal)
        saveStoredDashboardData({
          holdings,
          watchlist,
          journal: nextJournal,
        })
      },
    }),
    [loadCalendar, loadDisclosures, loadLiveNews],
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar px-3 py-4 lg:block">
          <div className="mb-6 flex items-center gap-3 px-2">
            <div className="flex size-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <ChartCandlestick className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Tracking Money</div>
              <div className="text-xs text-muted-foreground">시장 레이더</div>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <Button
                key={item.label}
                type="button"
                variant={activePage === item.id ? 'secondary' : 'ghost'}
                className={cn('w-full justify-start text-muted-foreground', activePage === item.id && 'text-foreground')}
                onClick={() => setActivePage(item.id)}
              >
                <item.icon className="size-4" />
                {item.label}
              </Button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md border border-border bg-card lg:hidden">
                  <ChartCandlestick className="size-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-base font-semibold">{currentPage.label}</h1>
                  <p className="text-xs text-muted-foreground">{currentPage.subtitle}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">
                  <Clock3 className="mr-1 size-3" />
                  업데이트 {snapshot.marketStatus.lastUpdated}
                </Badge>
                <Badge variant={quoteStatusVariant}>{snapshot.quoteMessage}</Badge>
                <Badge variant="secondary">{snapshot.marketStatus.usSession}</Badge>
                <Badge variant="warning">국내장 개장 {snapshot.marketStatus.koreaOpenIn}</Badge>
                <Badge variant="negative">USD/KRW {snapshot.marketStatus.usdKrw}</Badge>
                <Badge variant="positive">VIX {snapshot.marketStatus.vix}</Badge>
                <Button size="icon" variant="outline" aria-label="시세 새로고침" onClick={() => void loadQuotes()} disabled={quoteStatus === 'loading'}>
                  <RefreshCw className={cn('size-4', quoteStatus === 'loading' && 'animate-spin')} />
                </Button>
                <Button size="icon" variant="outline" aria-label="알림" onClick={() => setActivePage('alerts')}>
                  <Bell className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-3 w-full overflow-hidden lg:hidden">
              <nav className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
                {navItems.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    size="sm"
                    variant={activePage === item.id ? 'secondary' : 'ghost'}
                    className={cn('shrink-0 text-muted-foreground', activePage === item.id && 'text-foreground')}
                    onClick={() => setActivePage(item.id)}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Button>
                ))}
              </nav>
            </div>
          </header>

          {activePage === 'dashboard' ? (
          <div className="mx-auto grid max-w-[1600px] gap-4 p-4 md:p-6">
            <section className="grid gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card className="overflow-hidden">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>내일 국내장 방향점수</CardTitle>
                      <CardDescription>{snapshot.biasScore.summary}</CardDescription>
                    </div>
                    <Badge variant={snapshot.biasScore.stance === 'pressure' ? 'negative' : snapshot.biasScore.stance === 'neutral' ? 'neutral' : 'positive'}>신뢰도 {confidenceLabel[snapshot.biasScore.confidence]}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[0.85fr_1fr]">
                  <div>
                    <div className="mb-2 flex items-end gap-3">
                      <div className="text-5xl font-semibold leading-none text-foreground">+{snapshot.biasScore.score}</div>
                      <div className="pb-1 text-sm text-muted-foreground">/ 100</div>
                    </div>
                    <div className="mb-4 flex items-center gap-2">
                      <Gauge className="size-4 text-primary" />
                      <span className="text-sm font-medium">
                        {snapshot.biasScore.stance === 'favorable'
                          ? '우호적이지만 환율 확인 필요'
                          : snapshot.biasScore.stance === 'pressure'
                            ? '부담 우세, 장 초반 수급 확인'
                            : '중립권, 가격 반응 확인'}
                      </span>
                    </div>
                    <Progress value={snapshot.biasScore.score} />
                  </div>

                  <div className="grid gap-3 2xl:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">긍정 요인</div>
                      <div className="space-y-2">
                        {snapshot.biasScore.positives.map((factor) => (
                          <div key={factor.label} className="flex items-center justify-between gap-3 text-sm">
                            <span>{factor.label}</span>
                            <Badge variant="positive">+{factor.impact}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">부담 요인</div>
                      <div className="space-y-2">
                        {snapshot.biasScore.risks.map((factor) => (
                          <div key={factor.label} className="flex items-center justify-between gap-3 text-sm">
                            <span>{factor.label}</span>
                            <Badge variant={factor.impact < 0 ? 'negative' : 'warning'}>{factor.impact}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>핵심 이슈</CardTitle>
                  <CardDescription>{snapshot.liveNews.length > 0 ? snapshot.newsMessage : '국내장 영향 가능성이 큰 순서로 정리'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboardIssues.map((issue) => {
                    const isLiveIssue = 'publishedAt' in issue
                    const issueTime = isLiveIssue ? formatNewsTime(issue.publishedAt) : issue.time
                    const issueTags = isLiveIssue ? [issue.keyword, issue.source, ...issue.sectors] : issue.sectors

                    return (
                      <div key={issue.id} className="rounded-md border border-border bg-muted/15 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="neutral">{issueTime}</Badge>
                          <Badge variant={directionVariant(issue.direction)}>{importanceLabel[issue.importance]}</Badge>
                          {issueTags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="text-sm font-medium leading-5">{issue.title}</div>
                        <div className="mt-2 text-xs leading-5 text-muted-foreground">{issue.expectedImpact}</div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle>내일장 예측 요약</CardTitle>
                    <CardDescription>{snapshot.forecast.summary}</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setActivePage('forecast')}>
                    <LineChart className="size-4" />
                    예측 보기
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="text-xs text-muted-foreground">기준 흐름</div>
                  <div className="mt-2 text-lg font-semibold">{snapshot.forecast.openingBias}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="text-xs text-muted-foreground">예상 출발</div>
                  <div className="mt-2 text-lg font-semibold">{snapshot.forecast.expectedOpenRange}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="text-xs text-muted-foreground">신뢰도</div>
                  <div className="mt-2 text-lg font-semibold">{confidenceLabel[snapshot.forecast.confidence]}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="text-xs text-muted-foreground">상방 / 하방</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="positive">{snapshot.forecast.scenarios.find((item) => item.id === 'upside')?.probability ?? 0}%</Badge>
                    <Badge variant="negative">{snapshot.forecast.scenarios.find((item) => item.id === 'downside')?.probability ?? 0}%</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <ActionQueuePanel
              items={snapshot.actionQueue}
              title="오늘 액션 큐"
              description="지표, 뉴스, 공시, 캘린더, 보유/관심종목을 합친 우선순위"
              maxItems={4}
              compact
            />

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle>DART 공시 체크</CardTitle>
                    <CardDescription>{snapshot.disclosureMessage}</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setActivePage('disclosures')}>
                    <FileText className="size-4" />
                    공시 보기
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {snapshot.disclosures.length > 0 ? (
                  <div className="grid gap-3 lg:grid-cols-3">
                    {snapshot.disclosures.slice(0, 3).map((item) => (
                      <a
                        key={item.id}
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-md border border-border bg-muted/15 p-4 transition hover:border-primary/45 hover:bg-muted/25"
                      >
                        <div className="mb-3 flex flex-wrap gap-2">
                          <Badge variant="neutral">{formatDisclosureDate(item.submittedAt)}</Badge>
                          <Badge variant={directionVariant(item.direction)}>{directionLabel[item.direction]}</Badge>
                          <Badge variant={item.importance === 'high' ? 'warning' : 'neutral'}>{importanceLabel[item.importance]}</Badge>
                        </div>
                        <div className="text-sm font-semibold">{item.corpName}</div>
                        <div className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.reportName}</div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-muted/15 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={snapshot.disclosureStatus === 'error' ? 'negative' : 'warning'}>
                        {snapshot.disclosureStatus === 'loading' ? '확인 중' : snapshot.disclosureStatus === 'error' ? '연결 오류' : '설정 필요'}
                      </Badge>
                      <Badge variant="secondary">OPENDART_API_KEY</Badge>
                    </div>
                    <div className="text-sm leading-6 text-muted-foreground">
                      OpenDART 키를 Vercel 환경변수에 추가하면 국내 보유/관심종목의 공시 원문이 이 영역과 액션 큐에 반영됩니다.
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>미국 선행 지표</CardTitle>
                  <CardDescription>NQ 선물, SOX, 변동성, 달러, 금리, 환율</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {snapshot.leadingIndicators.map((indicator) => (
                      <div key={indicator.symbol} className="rounded-md border border-border bg-muted/15 p-3">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-mono text-sm font-semibold">{indicator.symbol}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{indicator.name}</div>
                          </div>
                          <Badge variant={directionVariant(indicator.direction)}>{formatChange(indicator.change)}</Badge>
                        </div>
                        <div className="text-lg font-semibold">{indicator.value}</div>
                        <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                          {directionIcon(indicator.direction)}
                          <span>{indicator.note}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>방향점수 흐름</CardTitle>
                  <CardDescription>야간 점수 변화</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={biasTimeline} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="biasFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          color: 'var(--popover-foreground)',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="score"
                        name="방향점수"
                        stroke="var(--chart-1)"
                        fill="url(#biasFill)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>포트폴리오 영향도</CardTitle>
                  <CardDescription>보유종목별 이슈 압력과 가격 흐름</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>티커</TableHead>
                        <TableHead>종목명</TableHead>
                        <TableHead>현재가</TableHead>
                        <TableHead>등락</TableHead>
                        <TableHead>비중</TableHead>
                        <TableHead>영향</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.holdings.map((holding) => (
                        <TableRow key={holding.symbol}>
                          <TableCell className="font-mono font-medium">{holding.symbol}</TableCell>
                          <TableCell>{holding.name}</TableCell>
                          <TableCell>{formatCurrency(holding.currentPrice, holding.market)}</TableCell>
                          <TableCell>
                            <Badge variant={holding.dayChange >= 0 ? 'positive' : 'negative'}>
                              {formatChange(holding.dayChange)}
                            </Badge>
                          </TableCell>
                          <TableCell>{holding.portfolioWeight}%</TableCell>
                          <TableCell>
                            <div className="flex max-w-[280px] items-start gap-2">
                              <Badge variant={directionVariant(holding.impact)}>{directionLabel[holding.impact]}</Badge>
                              <span className="text-xs leading-5 text-muted-foreground">{holding.impactNote}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>관심종목 트리거</CardTitle>
                  <CardDescription>관심 매수가와 이슈 조건 도달 여부</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {snapshot.watchlist.map((item) => (
                    <div key={item.symbol} className="rounded-md border border-border bg-muted/15 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-semibold">{item.symbol}</div>
                          <div className="text-xs text-muted-foreground">{item.name}</div>
                        </div>
                        <Badge variant={item.status === 'near' ? 'positive' : item.status === 'alert' ? 'warning' : 'neutral'}>
                          {watchStatusLabel[item.status]} · 매수가까지 {item.distanceToBuy.toFixed(1)}%
                        </Badge>
                      </div>
                      <div className="mt-3 text-sm">{item.trigger}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div className="rounded-md bg-background/70 p-2">현재 {formatCurrency(item.currentPrice, item.symbol.length === 6 ? 'KR' : 'US')}</div>
                        <div className="rounded-md bg-background/70 p-2">관심가 {formatCurrency(item.targetBuyPrice, item.symbol.length === 6 ? 'KR' : 'US')}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <Card>
                <CardHeader>
                  <CardTitle>지표 변화 지도</CardTitle>
                  <CardDescription>장 시작 전 긍정/부담 압력 비교</CardDescription>
                </CardHeader>
                <CardContent className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={indicatorChartData} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="symbol" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          color: 'var(--popover-foreground)',
                        }}
                      />
                      <Bar dataKey="change" name="등락률" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>이벤트 캘린더</CardTitle>
                  <CardDescription>{snapshot.calendarMessage}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {snapshot.calendarEvents.slice(0, 5).map((event) => (
                    <div key={event.id} className="rounded-md border border-border bg-muted/15 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">
                          {event.date} · {event.time}
                        </Badge>
                        <Badge variant={event.importance === 'high' ? 'warning' : 'neutral'}>
                          {importanceLabel[event.importance]}
                        </Badge>
                        <Badge variant={calendarEventStatusVariant(event)}>
                          {event.status ? calendarStatusLabel[event.status] : '점검'}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium">{event.title}</div>
                      {event.description ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{event.description}</div> : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {event.relatedSymbols.map((symbol) => (
                          <Badge key={symbol} variant="secondary">
                            {symbol}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader>
                <CardTitle>오늘 대응 메모</CardTitle>
                <CardDescription>장 시작 전 시나리오와 장 후 리뷰</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-md border border-positive/25 bg-positive/10 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-positive">
                    <TrendingUp className="size-4" />
                    상승 시나리오
                  </div>
                  <p className="text-sm leading-6 text-foreground/85">{actionMemo.bullishScenario}</p>
                </div>
                <div className="rounded-md border border-negative/25 bg-negative/10 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-negative">
                    <TrendingDown className="size-4" />
                    하락 시나리오
                  </div>
                  <p className="text-sm leading-6 text-foreground/85">{actionMemo.bearishScenario}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/15 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <LineChart className="size-4 text-primary" />
                    장 시작 전 체크
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {actionMemo.watchBeforeOpen.map((item) => (
                      <Badge key={item} variant="neutral">
                        {item}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{actionMemo.afterMarketReview}</p>
                </div>
              </CardContent>
            </Card>
          </div>
          ) : (
            renderPage(activePage, snapshot, actions)
          )}
        </main>
      </div>
    </div>
  )
}
