import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  CalendarDays,
  ChartCandlestick,
  Check,
  Clock3,
  Copy,
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
  newsKeywords as defaultNewsKeywords,
  watchlist,
} from '@/data/mock-dashboard'
import { cn } from '@/lib/utils'
import type {
  ActionQueueItem,
  AlertRule,
  AlertHistoryItem,
  AlertSettings,
  BiasScore,
  CalendarEvent,
  DataReliability,
  Direction,
  DisclosureItem,
  ExecutionPlan,
  ExecutionPlanItem,
  ForecastSensitivity,
  ForecastReview,
  Holding,
  InvestmentJournal,
  JournalHistoryItem,
  KoreaMarketBridge,
  LiveNewsItem,
  MarketIndicator,
  MarketQuote,
  MorningBrief,
  NewsImpactBoard,
  OvernightStressTest,
  PortfolioPlaybook,
  PreMarketCommandCenter,
  SignalAudit,
  SignalAuditSource,
  TriggeredAlert,
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
  requiredEnv?: string[]
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

type ProfileSyncStatus = 'idle' | 'checking' | 'ready' | 'missing' | 'saving' | 'loading' | 'empty' | 'error'

type ProfileSyncApiResponse = {
  configured: boolean
  status?: ProfileSyncStatus | 'unauthorized' | 'invalid'
  data?: StoredDashboardData | null
  updatedAt?: string | null
  source?: string
  storage?: string
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

type ScenarioShockSymbol = 'SOX' | 'NQ=F' | 'USD/KRW' | 'VIX' | 'US10Y'

type ScenarioShockState = Record<ScenarioShockSymbol, number>

type ScenarioSimulationFactor = {
  symbol: ScenarioShockSymbol
  label: string
  shock: number
  scoreImpact: number
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  note: string
}

type ScenarioSimulationPosition = {
  symbol: string
  name: string
  impactPercent: number
  impactKrw: number
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  sensitivity: string[]
}

type ScenarioSimulationResult = {
  score: number
  scoreDelta: number
  scoreTone: 'positive' | 'negative' | 'warning' | 'neutral'
  label: string
  kospiRange: string
  kosdaqRange: string
  portfolioImpactKrw: number
  portfolioImpactPercent: number
  summary: string
  action: string
  factors: ScenarioSimulationFactor[]
  positions: ScenarioSimulationPosition[]
}

type CatalystSource = 'news' | 'calendar' | 'disclosure'

type CatalystBucket = 'now' | 'today' | 'overnight' | 'upcoming'

type CatalystRadarItem = {
  id: string
  source: CatalystSource
  bucket: CatalystBucket
  timeLabel: string
  title: string
  summary: string
  score: number
  direction: Direction
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  importance: 'low' | 'medium' | 'high'
  relatedSymbols: string[]
  action: string
}

type CatalystRadar = {
  generatedAt: string
  summary: string
  totalCount: number
  urgentCount: number
  highImportanceCount: number
  topSource: CatalystSource | 'none'
  topSymbols: string[]
  buckets: Record<CatalystBucket, CatalystRadarItem[]>
  items: CatalystRadarItem[]
}

type MarketPulseSource = 'indicator' | CatalystSource | 'alert'
type MarketPulseHorizon = 'now' | 'preopen' | 'session' | 'overnight'

type MarketPulseItem = {
  id: string
  source: MarketPulseSource
  horizon: MarketPulseHorizon
  timeLabel: string
  title: string
  summary: string
  direction: Direction
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  impactScore: number
  opportunityScore: number
  pressureScore: number
  evidence: string
  action: string
  relatedSymbols: string[]
}

type MarketPulseRail = {
  generatedAt: string
  summary: string
  netScore: number
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  opportunityScore: number
  pressureScore: number
  urgentCount: number
  topSymbols: string[]
  playbook: string[]
  items: MarketPulseItem[]
}

type MarketSessionPhase = 'overnight' | 'preopen' | 'opening' | 'session' | 'closing' | 'aftermarket' | 'closed'

type MarketSessionTask = {
  id: string
  title: string
  summary: string
  priority: ActionQueueItem['priority']
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  evidence: string
}

type MarketSessionControl = {
  generatedAt: string
  kstTimeLabel: string
  phase: MarketSessionPhase
  phaseLabel: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  summary: string
  nextCheckpointLabel: string
  nextCheckpointTimeLabel: string
  minutesToNext: number | null
  tradeMode: string
  focusSymbols: string[]
  tasks: MarketSessionTask[]
  guardrails: string[]
}

type ForecastCalibrationRecent = {
  id: string
  dateLabel: string
  forecastLabel: string
  forecastScore: number
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  executionRate: number
  summary: string
}

type ForecastCalibration = {
  generatedAt: string
  sampleCount: number
  averageScore: number
  hitRate: number
  actionCompletionRate: number
  currentScore: number
  currentLabel: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  label: string
  summary: string
  lesson: string
  nextFocus: string[]
  recent: ForecastCalibrationRecent[]
}

type DataFreshnessSource = {
  id: DataReliability['sources'][number]['id']
  name: string
  modeLabel: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  statusLabel: string
  updatedAt: string | null
  updatedLabel: string
  ageMinutes: number | null
  ageLabel: string
  staleAfterMinutes: number
  cadenceLabel: string
  summary: string
  nextAction: string
}

type DataFreshness = {
  generatedAt: string
  score: number
  label: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  summary: string
  staleCount: number
  missingCount: number
  nextRefreshLabel: string
  sources: DataFreshnessSource[]
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
  calendarEvents: CalendarEvent[]
  newsKeywords: string[]
  alertRules: AlertRule[]
  alertSettings: AlertSettings
  alertHistory: AlertHistoryItem[]
  journal: InvestmentJournal
  journalHistory: JournalHistoryItem[]
}

type DashboardBackup = {
  version: 1
  exportedAt: string
  data: StoredDashboardData
}

type DashboardSnapshot = {
  holdings: Holding[]
  watchlist: WatchItem[]
  newsKeywords: string[]
  alertRules: AlertRule[]
  alertSettings: AlertSettings
  alertHistory: AlertHistoryItem[]
  triggeredAlerts: TriggeredAlert[]
  storedData: StoredDashboardData
  leadingIndicators: MarketIndicator[]
  biasScore: BiasScore
  marketStatus: MarketStatusView
  quoteStatus: QuoteStatus
  quoteMessage: string
  liveQuoteCount: number
  usdKrw: number
  fetchedAt: string | null
  calendarEvents: CalendarEvent[]
  calendarStatus: CalendarStatus
  calendarMessage: string
  liveNews: LiveNewsItem[]
  newsStatus: NewsStatus
  newsMessage: string
  newsImpactBoard: NewsImpactBoard
  catalystRadar: CatalystRadar
  marketPulse: MarketPulseRail
  disclosures: DisclosureItem[]
  disclosureStatus: DisclosureStatus
  disclosureMessage: string
  forecast: MarketForecast
  portfolioPlaybook: PortfolioPlaybook
  morningBrief: MorningBrief
  dataReliability: DataReliability
  dataFreshness: DataFreshness
  signalAudit: SignalAudit
  koreaMarketBridge: KoreaMarketBridge
  forecastSensitivity: ForecastSensitivity
  overnightStressTest: OvernightStressTest
  forecastReview: ForecastReview
  forecastCalibration: ForecastCalibration
  executionPlan: ExecutionPlan
  preMarketCommand: PreMarketCommandCenter
  marketSession: MarketSessionControl
  actionQueue: ActionQueueItem[]
  journal: InvestmentJournal
}

const storageKey = 'tracking-money-dashboard-v1'

const indicatorSymbols = [
  'KOSPI',
  'KOSDAQ',
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
  KOSPI: '국내 대형주 실제 마감 흐름과 예측 검증 기준',
  KOSDAQ: '성장주와 개인 수급 체감 흐름 확인',
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

const alertRuleTypeLabel: Record<AlertRule['type'], string> = {
  'price-above': '가격 이상',
  'price-below': '가격 이하',
  'change-above': '등락률 이상',
  'change-below': '등락률 이하',
  'news-keyword': '뉴스 키워드',
  'bias-above': '방향점수 이상',
  'bias-below': '방향점수 이하',
}

const alertSeverityLabel: Record<TriggeredAlert['severity'], string> = {
  critical: '긴급',
  high: '높음',
  medium: '보통',
  low: '낮음',
}

const portfolioSeverityLabel: Record<PortfolioPlaybook['riskSignals'][number]['severity'], string> = {
  critical: '긴급',
  high: '높음',
  medium: '보통',
  low: '낮음',
}

const positionActionLabel: Record<PortfolioPlaybook['positionPlans'][number]['action'], string> = {
  hold: '보유 유지',
  observe: '관찰',
  'add-ready': '분할 준비',
  'trim-watch': '축소 감시',
  avoid: '진입 보류',
}

const watchStatusLabel = {
  near: '근접',
  waiting: '대기',
  alert: '확인',
}

const defaultAlertRules: AlertRule[] = [
  {
    id: 'default-bias-pressure',
    name: '방향점수 45 이하',
    type: 'bias-below',
    target: 'KOSPI',
    threshold: 45,
    enabled: true,
    createdAt: '2026-07-08T00:00:00.000Z',
  },
  {
    id: 'default-vix-spike',
    name: 'VIX 급등',
    type: 'change-above',
    target: 'VIX',
    threshold: 5,
    enabled: true,
    createdAt: '2026-07-08T00:00:00.000Z',
  },
  {
    id: 'default-usdkrw-risk',
    name: '환율 상승 부담',
    type: 'change-above',
    target: 'USD/KRW',
    threshold: 0.5,
    enabled: true,
    createdAt: '2026-07-08T00:00:00.000Z',
  },
  {
    id: 'default-ai-news',
    name: 'AI 고중요 뉴스',
    type: 'news-keyword',
    target: 'AI',
    threshold: 0,
    enabled: true,
    createdAt: '2026-07-08T00:00:00.000Z',
  },
]

const defaultAlertSettings: AlertSettings = {
  browserNotifications: false,
  minimumSeverity: 'medium',
}

const symbolProfiles: Record<string, { sector: string; sensitivity: string[] }> = {
  '005930': { sector: '반도체', sensitivity: ['SOX', 'USD/KRW', 'NQ=F'] },
  '000660': { sector: '반도체', sensitivity: ['SOX', 'USD/KRW', 'NQ=F'] },
  '035420': { sector: '인터넷', sensitivity: ['US10Y', 'NQ=F'] },
  '373220': { sector: '배터리', sensitivity: ['USD/KRW', 'TSLA'] },
  AAPL: { sector: '빅테크', sensitivity: ['NQ=F', 'DXY'] },
  NVDA: { sector: 'AI 반도체', sensitivity: ['SOX', 'NQ=F'] },
  TSLA: { sector: '전기차', sensitivity: ['NQ=F', 'DXY'] },
}

const koreaBridgeSymbols = ['SOX', 'NQ=F', 'USD/KRW', 'VIX', 'US10Y', 'DXY', 'ES=F'] as const

const koreaBridgeMeta: Record<
  (typeof koreaBridgeSymbols)[number],
  {
    weight: number
    threshold: number
    koreanImpact: string
    confirmation: string
    relatedSymbols: string[]
  }
> = {
  SOX: {
    weight: 28,
    threshold: 1.2,
    koreanImpact: '필라델피아 반도체는 삼성전자와 SK하이닉스의 장 초반 방향에 가장 직접적으로 이어집니다.',
    confirmation: '삼성전자·SK하이닉스가 KOSPI보다 강한지 먼저 확인',
    relatedSymbols: ['005930', '000660', 'NVDA', 'SOX'],
  },
  'NQ=F': {
    weight: 24,
    threshold: 1,
    koreanImpact: '나스닥100 선물은 국내 성장주와 코스닥 투자심리의 선행 온도계입니다.',
    confirmation: '코스닥 대형 성장주와 NAVER, 배터리주의 첫 30분 상대강도 확인',
    relatedSymbols: ['KOSDAQ', '035420', '373220', 'AAPL', 'NVDA'],
  },
  'USD/KRW': {
    weight: 18,
    threshold: 0.8,
    koreanImpact: '달러/원 상승은 외국인 수급과 국내 대형주 밸류에이션에 부담으로 작동합니다.',
    confirmation: '달러/원 첫 고시와 외국인 KOSPI200 선물 순매수 전환 여부 확인',
    relatedSymbols: ['KOSPI', '005930', '000660', '373220'],
  },
  VIX: {
    weight: 14,
    threshold: 4,
    koreanImpact: 'VIX 상승은 위험회피 심리를 키워 갭상승 추격보다 방어 기준을 우선하게 만듭니다.',
    confirmation: '장 시작 직후 지수 상승 종목 수와 하락 종목 수의 확산 여부 확인',
    relatedSymbols: ['KOSPI', 'KOSDAQ', 'NQ=F'],
  },
  US10Y: {
    weight: 10,
    threshold: 1.5,
    koreanImpact: '미국 10년물 금리 상승은 성장주 할인율 부담으로 이어질 수 있습니다.',
    confirmation: '성장주가 지수 대비 약하면 추격 매수는 보류',
    relatedSymbols: ['KOSDAQ', '035420', 'AAPL', 'TSLA'],
  },
  DXY: {
    weight: 8,
    threshold: 0.8,
    koreanImpact: '달러 인덱스 강세는 환율과 외국인 수급 부담으로 국내장에 후행 압력을 줄 수 있습니다.',
    confirmation: 'USD/KRW와 외국인 현·선물 동시 매수 여부 확인',
    relatedSymbols: ['USD/KRW', 'KOSPI'],
  },
  'ES=F': {
    weight: 8,
    threshold: 0.8,
    koreanImpact: 'S&P500 선물은 미국 전체 위험선호가 유지되는지 보는 보조 신호입니다.',
    confirmation: 'NQ=F와 같은 방향인지, 아니면 기술주만 따로 움직이는지 확인',
    relatedSymbols: ['KOSPI', 'NQ=F'],
  },
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

const profileSyncStatusLabel: Record<ProfileSyncStatus, string> = {
  idle: '대기',
  checking: '확인 중',
  ready: '동기화 가능',
  missing: '설정 필요',
  saving: '저장 중',
  loading: '불러오는 중',
  empty: '저장 없음',
  error: '오류',
}

function dataHealthVariant(status: DataHealthStatus): 'positive' | 'negative' | 'warning' | 'neutral' {
  if (status === 'ready' || status === 'local') return 'positive'
  if (status === 'partial' || status === 'fallback' || status === 'planned' || status === 'loading') return 'warning'
  if (status === 'error' || status === 'missing') return 'negative'
  return 'neutral'
}

function dataModeLabel(status: DataHealthStatus) {
  if (status === 'ready') return '실데이터'
  if (status === 'partial') return '부분 실데이터'
  if (status === 'fallback') return '대체 데이터'
  if (status === 'missing') return '설정 필요'
  if (status === 'error') return '연결 오류'
  if (status === 'loading') return '확인 중'
  if (status === 'local') return '로컬 저장'
  if (status === 'planned') return '연결 예정'
  return '대기'
}

function profileSyncVariant(status: ProfileSyncStatus): 'positive' | 'negative' | 'warning' | 'neutral' {
  if (status === 'ready') return 'positive'
  if (status === 'checking' || status === 'saving' || status === 'loading' || status === 'empty') return 'warning'
  if (status === 'missing' || status === 'error') return 'negative'
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

function normalizeNewsKeyword(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeNewsKeywords(value: unknown) {
  const keywords = stringArrayValue(value)
    .map(normalizeNewsKeyword)
    .filter(Boolean)

  const deduped = Array.from(new Map(keywords.map((keyword) => [keyword.toLocaleLowerCase('ko-KR'), keyword])).values())
  return deduped.length > 0 ? deduped.slice(0, 20) : defaultNewsKeywords
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

function normalizeJournalRecord(rawJournal: unknown): InvestmentJournal | null {
  if (!isRecord(rawJournal)) return null

  const today = getKstDateKey()
  const date = textValue(rawJournal.date, today)
  const normalizedDate = parseDateKey(date) ? date : today

  return {
    date: normalizedDate,
    preMarketPlan: textValue(rawJournal.preMarketPlan),
    riskPlan: textValue(rawJournal.riskPlan),
    afterMarketReview: textValue(rawJournal.afterMarketReview),
    completedActionIds: stringArrayValue(rawJournal.completedActionIds),
    lastSavedAt: typeof rawJournal.lastSavedAt === 'string' ? rawJournal.lastSavedAt : null,
  }
}

function hasJournalContent(journal: InvestmentJournal) {
  return (
    journal.preMarketPlan.trim().length > 0 ||
    journal.riskPlan.trim().length > 0 ||
    journal.afterMarketReview.trim().length > 0 ||
    journal.completedActionIds.length > 0
  )
}

function normalizeJournal(rawJournal: unknown): InvestmentJournal {
  const today = getKstDateKey()
  const journal = normalizeJournalRecord(rawJournal)
  if (!journal || journal.date !== today) return createDefaultJournal(today)
  return journal
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

function normalizeImportance(value: unknown): CalendarEvent['importance'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeCalendarEventType(value: unknown): CalendarEvent['type'] {
  if (value === 'earnings' || value === 'macro' || value === 'policy' || value === 'company' || value === 'dividend') return value
  return 'company'
}

function normalizeCalendarEventStatus(value: unknown): NonNullable<CalendarEvent['status']> {
  if (value === 'confirmed' || value === 'estimated' || value === 'watch') return value
  return 'watch'
}

function normalizeAlertRuleType(value: unknown): AlertRule['type'] {
  if (
    value === 'price-above' ||
    value === 'price-below' ||
    value === 'change-above' ||
    value === 'change-below' ||
    value === 'news-keyword' ||
    value === 'bias-above' ||
    value === 'bias-below'
  ) {
    return value
  }
  return 'price-below'
}

function normalizeWatchStatus(value: unknown, targetBuyPrice: number, currentPrice: number): WatchItem['status'] {
  if (value === 'near' || value === 'waiting' || value === 'alert') return value
  if (targetBuyPrice > 0 && currentPrice <= targetBuyPrice * 1.03) return 'near'
  return 'waiting'
}

function dedupeBySymbol<T extends { symbol: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.symbol, item])).values())
}

function dedupeCalendarEvents(items: CalendarEvent[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

function dedupeAlertRules(items: AlertRule[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

function severityRank(severity: TriggeredAlert['severity']) {
  if (severity === 'critical') return 4
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

function normalizeAlertSeverity(value: unknown): TriggeredAlert['severity'] {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeAlertSettings(value: unknown): AlertSettings {
  if (!isRecord(value)) return defaultAlertSettings

  return {
    browserNotifications: typeof value.browserNotifications === 'boolean' ? value.browserNotifications : defaultAlertSettings.browserNotifications,
    minimumSeverity: normalizeAlertSeverity(value.minimumSeverity),
  }
}

function alertDedupeKey(alert: Pick<TriggeredAlert, 'id' | 'evidence'>) {
  return `${alert.id}:${simpleHash(alert.evidence)}`
}

function simpleHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function dedupeAlertHistory(items: AlertHistoryItem[]) {
  return Array.from(new Map(items.map((item) => [item.dedupeKey, item])).values())
}

function createJournalHistoryItem({
  journal,
  forecastReview,
  actionQueue,
}: {
  journal: InvestmentJournal
  forecastReview?: ForecastReview
  actionQueue?: ActionQueueItem[]
}): JournalHistoryItem {
  const completedActionCount = actionQueue
    ? journal.completedActionIds.filter((id) => actionQueue.some((item) => item.id === id)).length
    : journal.completedActionIds.length
  const topActionTitle = actionQueue?.[0]?.title ?? null
  const archivedAt = new Date().toISOString()
  const idSeed = `${journal.date}|${journal.preMarketPlan}|${journal.riskPlan}|${journal.afterMarketReview}|${journal.completedActionIds.join(',')}`

  return {
    ...journal,
    id: `journal-${journal.date}-${simpleHash(idSeed)}`,
    archivedAt,
    forecastScore: forecastReview?.score ?? 0,
    forecastLabel: forecastReview?.label ?? '수동 보관',
    forecastSummary: forecastReview?.summary ?? '보관 시점의 예측 검증 요약이 없습니다.',
    completedActionCount,
    totalActionCount: actionQueue?.length ?? journal.completedActionIds.length,
    topActionTitle,
  }
}

function normalizeImportedJournalHistoryItem(value: unknown): JournalHistoryItem | null {
  const journal = normalizeJournalRecord(value)
  if (!journal) return null

  const raw = isRecord(value) ? value : {}
  const archivedAt = typeof raw.archivedAt === 'string' ? raw.archivedAt : journal.lastSavedAt ?? new Date().toISOString()
  const idSeed = `${journal.date}|${journal.preMarketPlan}|${journal.riskPlan}|${journal.afterMarketReview}|${journal.completedActionIds.join(',')}`

  return {
    ...journal,
    id: textValue(raw.id, `journal-${journal.date}-${simpleHash(idSeed)}`),
    archivedAt,
    forecastScore: clamp(numberValue(raw.forecastScore), 0, 100),
    forecastLabel: textValue(raw.forecastLabel, '수동 보관'),
    forecastSummary: textValue(raw.forecastSummary, '보관된 저널입니다.'),
    completedActionCount: Math.max(0, Math.round(numberValue(raw.completedActionCount, journal.completedActionIds.length))),
    totalActionCount: Math.max(0, Math.round(numberValue(raw.totalActionCount, journal.completedActionIds.length))),
    topActionTitle: textValue(raw.topActionTitle) || null,
  }
}

function dedupeJournalHistory(items: JournalHistoryItem[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
    .sort((a, b) => {
      const archivedDiff = new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
      if (Number.isFinite(archivedDiff) && archivedDiff !== 0) return archivedDiff
      return b.date.localeCompare(a.date)
    })
    .slice(0, 60)
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

function normalizeImportedCalendarEvent(value: unknown): CalendarEvent | null {
  if (!isRecord(value)) return null

  const title = normalizeNewsKeyword(textValue(value.title))
  if (!title) return null

  const absoluteDate = textValue(value.absoluteDate, getKstDateKey())
  const normalizedDate = parseDateKey(absoluteDate) ? absoluteDate : getKstDateKey()
  const rawTime = textValue(value.time, '09:00')
  const time = /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : '09:00'
  const relatedSymbols = stringArrayValue(value.relatedSymbols)
    .map(normalizeUserSymbol)
    .filter(Boolean)
    .slice(0, 8)

  return {
    id: textValue(value.id, `user-calendar-${simpleHash(`${normalizedDate}-${time}-${title}`)}`),
    date: textValue(value.date, formatCalendarDateLabel(normalizedDate)),
    absoluteDate: normalizedDate,
    time,
    title,
    type: normalizeCalendarEventType(value.type),
    importance: normalizeImportance(value.importance),
    relatedSymbols,
    status: normalizeCalendarEventStatus(value.status),
    confidence: value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low' ? value.confidence : 'medium',
    source: textValue(value.source, '개인 캘린더'),
    description: textValue(value.description),
  }
}

function normalizeImportedAlertRule(value: unknown): AlertRule | null {
  if (!isRecord(value)) return null

  const type = normalizeAlertRuleType(value.type)
  const target = type === 'bias-above' || type === 'bias-below' ? textValue(value.target, 'KOSPI') : normalizeNewsKeyword(textValue(value.target))
  if (!target) return null

  const id = textValue(value.id, `alert-${type}-${target}-${Math.round(numberValue(value.threshold))}`)
  const name = textValue(value.name, `${target} ${alertRuleTypeLabel[type]}`)

  return {
    id,
    name,
    type,
    target,
    threshold: numberValue(value.threshold),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
  }
}

function normalizeImportedAlertHistoryItem(value: unknown): AlertHistoryItem | null {
  if (!isRecord(value)) return null

  const id = textValue(value.id)
  const ruleId = textValue(value.ruleId)
  const title = textValue(value.title)
  const evidence = textValue(value.evidence)
  if (!id || !ruleId || !title || !evidence) return null

  const alert = {
    id,
    ruleId,
    title,
    summary: textValue(value.summary),
    severity: normalizeAlertSeverity(value.severity),
    evidence,
    relatedSymbols: stringArrayValue(value.relatedSymbols),
  } satisfies TriggeredAlert

  return {
    ...alert,
    dedupeKey: textValue(value.dedupeKey, alertDedupeKey(alert)),
    triggeredAt: typeof value.triggeredAt === 'string' ? value.triggeredAt : new Date().toISOString(),
    read: typeof value.read === 'boolean' ? value.read : false,
    notificationSent: typeof value.notificationSent === 'boolean' ? value.notificationSent : false,
  }
}

function normalizeStoredDashboardData(value: unknown): StoredDashboardData | null {
  const candidate = isRecord(value) && isRecord(value.data) ? value.data : value
  if (!isRecord(candidate) || !Array.isArray(candidate.holdings) || !Array.isArray(candidate.watchlist)) return null

  const rawJournal = normalizeJournalRecord(candidate.journal)
  const staleJournalHistory =
    rawJournal && rawJournal.date !== getKstDateKey() && hasJournalContent(rawJournal)
      ? [createJournalHistoryItem({ journal: rawJournal })]
      : []
  const importedJournalHistory = Array.isArray(candidate.journalHistory)
    ? candidate.journalHistory.map(normalizeImportedJournalHistoryItem).filter((item): item is JournalHistoryItem => item !== null)
    : []

  return {
    holdings: dedupeBySymbol(candidate.holdings.map(normalizeImportedHolding).filter((item): item is Holding => item !== null)),
    watchlist: dedupeBySymbol(candidate.watchlist.map(normalizeImportedWatchItem).filter((item): item is WatchItem => item !== null)),
    calendarEvents: Array.isArray(candidate.calendarEvents)
      ? dedupeCalendarEvents(candidate.calendarEvents.map(normalizeImportedCalendarEvent).filter((item): item is CalendarEvent => item !== null)).slice(0, 60)
      : [],
    newsKeywords: normalizeNewsKeywords(candidate.newsKeywords),
    alertRules: Array.isArray(candidate.alertRules)
      ? dedupeAlertRules(candidate.alertRules.map(normalizeImportedAlertRule).filter((item): item is AlertRule => item !== null))
      : defaultAlertRules,
    alertSettings: normalizeAlertSettings(candidate.alertSettings),
    alertHistory: Array.isArray(candidate.alertHistory)
      ? dedupeAlertHistory(candidate.alertHistory.map(normalizeImportedAlertHistoryItem).filter((item): item is AlertHistoryItem => item !== null)).slice(0, 100)
      : [],
    journal: normalizeJournal(candidate.journal),
    journalHistory: dedupeJournalHistory([...staleJournalHistory, ...importedJournalHistory]),
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
      message: `보유 ${data.holdings.length}개, 관심 ${data.watchlist.length}개, 개인 일정 ${data.calendarEvents.length}개, 뉴스 키워드 ${data.newsKeywords.length}개, 알림 ${data.alertRules.length}개, 기록 ${data.alertHistory.length}개, 투자노트 ${data.journalHistory.length}개를 가져왔습니다.`,
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

function minutesSince(value: string | null, now = Date.now()) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, Math.round((now - date.getTime()) / 60_000))
}

function freshnessAgeLabel(ageMinutes: number | null) {
  if (ageMinutes === null) return '수신 전'
  if (ageMinutes < 1) return '방금'
  if (ageMinutes < 60) return `${ageMinutes}분 전`
  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60
  if (hours < 24) return minutes > 0 ? `${hours}시간 ${minutes}분 전` : `${hours}시간 전`
  const days = Math.floor(hours / 24)
  return `${days}일 전`
}

function freshnessTone(ageMinutes: number | null, staleAfterMinutes: number, sourceTone: DataReliability['sources'][number]['tone']): DataFreshnessSource['tone'] {
  if (ageMinutes === null) return 'negative'
  if (ageMinutes > staleAfterMinutes * 2) return 'negative'
  if (ageMinutes > staleAfterMinutes) return 'warning'
  return sourceTone === 'positive' ? 'positive' : sourceTone === 'negative' ? 'warning' : sourceTone
}

function freshnessStatusLabel(ageMinutes: number | null, staleAfterMinutes: number) {
  if (ageMinutes === null) return '수신 전'
  if (ageMinutes > staleAfterMinutes * 2) return '오래됨'
  if (ageMinutes > staleAfterMinutes) return '갱신 필요'
  return '최신'
}

type NotificationPermissionState = NotificationPermission | 'unsupported'

function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

function shouldDeliverBrowserNotification(severity: TriggeredAlert['severity'], settings: AlertSettings) {
  return settings.browserNotifications && severityRank(severity) >= severityRank(settings.minimumSeverity)
}

function createAlertHistoryItem(alert: TriggeredAlert, notificationSent: boolean): AlertHistoryItem {
  return {
    ...alert,
    dedupeKey: alertDedupeKey(alert),
    triggeredAt: new Date().toISOString(),
    read: false,
    notificationSent,
  }
}

function sendBrowserNotification(alert: TriggeredAlert, settings: AlertSettings) {
  if (!shouldDeliverBrowserNotification(alert.severity, settings)) return false
  if (getNotificationPermissionState() !== 'granted') return false

  try {
    const notification = new window.Notification(`Tracking Money · ${alert.title}`, {
      body: `${alertSeverityLabel[alert.severity]} · ${alert.summary}`,
      tag: alertDedupeKey(alert),
      requireInteraction: alert.severity === 'critical',
    })
    notification.onclick = () => window.focus()
    return true
  } catch {
    return false
  }
}

function getKoreaOpenText(now = new Date()) {
  const kstNow = getKstDate(now)
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

function getKstDate(now = new Date()) {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

function getKstDateKey(now = new Date()) {
  const kstNow = getKstDate(now)
  const year = kstNow.getFullYear()
  const month = String(kstNow.getMonth() + 1).padStart(2, '0')
  const day = String(kstNow.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatKstTimeLabel(now = new Date()) {
  return now.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatMinutesUntil(minutes: number | null) {
  if (minutes === null) return '다음 거래일'
  if (minutes <= 0) return '곧'
  if (minutes < 60) return `${minutes}분 후`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}시간 ${rest}분 후` : `${hours}시간 후`
}

function resolveMarketSessionPhase(now = new Date()) {
  const kstNow = getKstDate(now)
  const day = kstNow.getDay()
  const totalMinutes = kstNow.getHours() * 60 + kstNow.getMinutes()

  if (day === 0 || day === 6) {
    return {
      phase: 'closed' as const,
      phaseLabel: '휴장 준비',
      nextCheckpointLabel: '다음 평일 장전 점검',
      nextCheckpointTimeLabel: '06:30 KST',
      minutesToNext: null,
    }
  }
  if (totalMinutes < 390) {
    return {
      phase: 'overnight' as const,
      phaseLabel: '야간 선행지표',
      nextCheckpointLabel: '장전 데이터 점검',
      nextCheckpointTimeLabel: '06:30 KST',
      minutesToNext: 390 - totalMinutes,
    }
  }
  if (totalMinutes < 510) {
    return {
      phase: 'preopen' as const,
      phaseLabel: '장전 준비',
      nextCheckpointLabel: '개장 30분 전',
      nextCheckpointTimeLabel: '08:30 KST',
      minutesToNext: 510 - totalMinutes,
    }
  }
  if (totalMinutes < 540) {
    return {
      phase: 'preopen' as const,
      phaseLabel: '개장 직전',
      nextCheckpointLabel: '한국장 개장',
      nextCheckpointTimeLabel: '09:00 KST',
      minutesToNext: 540 - totalMinutes,
    }
  }
  if (totalMinutes < 570) {
    return {
      phase: 'opening' as const,
      phaseLabel: '개장 직후',
      nextCheckpointLabel: '첫 30분 확정',
      nextCheckpointTimeLabel: '09:30 KST',
      minutesToNext: 570 - totalMinutes,
    }
  }
  if (totalMinutes < 870) {
    return {
      phase: 'session' as const,
      phaseLabel: '장중 추적',
      nextCheckpointLabel: '마감 대응 준비',
      nextCheckpointTimeLabel: '14:30 KST',
      minutesToNext: 870 - totalMinutes,
    }
  }
  if (totalMinutes < 930) {
    return {
      phase: 'closing' as const,
      phaseLabel: '마감 대응',
      nextCheckpointLabel: '장후 복기',
      nextCheckpointTimeLabel: '15:30 KST',
      minutesToNext: 930 - totalMinutes,
    }
  }

  return {
    phase: 'aftermarket' as const,
    phaseLabel: '장후 복기',
    nextCheckpointLabel: '내일 장전 점검',
    nextCheckpointTimeLabel: '06:30 KST',
    minutesToNext: null,
  }
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function addDaysToDateKey(value: string, days: number) {
  const date = parseDateKey(value)
  if (!date) return value
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatCalendarDateLabel(absoluteDate: string) {
  const today = getKstDateKey()
  if (absoluteDate === today) return '오늘'
  if (absoluteDate === addDaysToDateKey(today, 1)) return '내일'
  const date = parseDateKey(absoluteDate)
  if (!date) return absoluteDate || '날짜 확인'

  return date.toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
}

function calendarEventSortValue(event: CalendarEvent) {
  const dateValue = event.absoluteDate ?? (event.date === '오늘' ? getKstDateKey() : event.date === '내일' ? addDaysToDateKey(getKstDateKey(), 1) : '9999-12-31')
  return `${dateValue}T${event.time || '23:59'}`
}

function mergeCalendarEvents(apiEvents: CalendarEvent[], userEvents: CalendarEvent[]) {
  return dedupeCalendarEvents([...apiEvents, ...userEvents])
    .map((event) => {
      if (!event.absoluteDate) return event
      return {
        ...event,
        date: formatCalendarDateLabel(event.absoluteDate),
      }
    })
    .sort((a, b) => calendarEventSortValue(a).localeCompare(calendarEventSortValue(b)))
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

function formatKrwAmount(value: number) {
  const abs = Math.abs(value)
  const prefix = value < 0 ? '-' : ''

  if (abs >= 100_000_000) return `${prefix}${round(abs / 100_000_000, 1).toLocaleString('ko-KR')}억`
  if (abs >= 10_000) return `${prefix}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`
  return `${prefix}${Math.round(abs).toLocaleString('ko-KR')}`
}

function formatSignedKrwAmount(value: number) {
  return value > 0 ? `+${formatKrwAmount(value)}` : formatKrwAmount(value)
}

function portfolioVariantFromSeverity(
  severity: PortfolioPlaybook['riskSignals'][number]['severity'],
): 'positive' | 'negative' | 'warning' | 'neutral' {
  if (severity === 'critical' || severity === 'high') return 'negative'
  if (severity === 'medium') return 'warning'
  return 'neutral'
}

function positionActionVariant(action: PortfolioPlaybook['positionPlans'][number]['action']): 'positive' | 'negative' | 'warning' | 'neutral' {
  if (action === 'add-ready' || action === 'hold') return 'positive'
  if (action === 'trim-watch' || action === 'avoid') return 'warning'
  return 'neutral'
}

function playbookPriorityVariant(priority: PortfolioPlaybook['positionPlans'][number]['priority']): 'positive' | 'negative' | 'warning' | 'neutral' {
  if (priority === 'critical') return 'negative'
  if (priority === 'high') return 'warning'
  if (priority === 'medium') return 'neutral'
  return 'neutral'
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

function buildKoreaMarketBridge(
  indicators: MarketIndicator[],
  holdingsData: Holding[],
  watchlistData: WatchItem[],
  biasScoreData: BiasScore,
): KoreaMarketBridge {
  const indicatorMap = new Map(indicators.map((indicator) => [indicator.symbol, indicator]))
  const trackedSymbols = new Set([...holdingsData.map((holding) => holding.symbol), ...watchlistData.map((item) => item.symbol)])
  const signals = koreaBridgeSymbols
    .reduce<KoreaMarketBridge['signals']>((acc, symbol) => {
      const indicator = indicatorMap.get(symbol)
      if (!indicator) return acc

      const meta = koreaBridgeMeta[symbol]
      const change = indicator.change
      const adjustedChange = inverseIndicators.has(symbol) ? -change : change
      const rawImpact = Math.abs(adjustedChange) < 0.05 ? 0 : Math.sign(adjustedChange) * meta.weight * clamp(Math.abs(change) / meta.threshold, 0.35, 1.5)
      const impact = clamp(Math.round(rawImpact), Math.round(meta.weight * -1.5), Math.round(meta.weight * 1.5))
      const direction: Direction = impact > 0 ? 'positive' : impact < 0 ? 'negative' : 'neutral'
      const trackedRelatedSymbols = meta.relatedSymbols.filter((relatedSymbol) => trackedSymbols.has(relatedSymbol))

      acc.push({
        id: `bridge-${symbol}`,
        symbol,
        name: indicator.name,
        change,
        direction,
        tone: directionVariant(direction),
        impact,
        weight: meta.weight,
        koreanImpact: meta.koreanImpact,
        confirmation: meta.confirmation,
        relatedSymbols: trackedRelatedSymbols.length > 0 ? trackedRelatedSymbols : meta.relatedSymbols,
      })

      return acc
    }, [])
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))

  const indicatorImpact = signals.reduce((sum, signal) => sum + signal.impact, 0)
  const score = clamp(Math.round(50 + indicatorImpact + (biasScoreData.score - 50) * 0.25), 0, 100)
  const topSignal = signals[0]
  const topRisk = signals.find((signal) => signal.impact < 0)
  const topPositive = signals.find((signal) => signal.impact > 0)
  const negativeCount = signals.filter((signal) => signal.impact < -4).length
  const riskLevel: KoreaMarketBridge['riskLevel'] = score <= 38 || negativeCount >= 3 ? 'high' : score <= 52 || negativeCount >= 2 ? 'medium' : 'low'
  const tone: KoreaMarketBridge['tone'] = score >= 62 ? 'positive' : score <= 43 ? 'negative' : riskLevel === 'medium' ? 'warning' : 'neutral'
  const label =
    score >= 72
      ? '미국발 강한 우호'
      : score >= 62
        ? '선별 우호'
        : score >= 45
          ? '중립 확인'
          : score >= 35
            ? '위험회피 압력'
            : '강한 방어'
  const openBias =
    score >= 72
      ? '갭상승 후 강한 종목 선별'
      : score >= 62
        ? '반도체·성장주 우선 확인'
        : score >= 45
          ? '첫 30분 수급 확인'
          : score >= 35
            ? '추격 매수 보류'
            : '현금·리스크 관리 우선'
  const kospiRange =
    score >= 72 ? '+0.4% ~ +1.0%' : score >= 62 ? '+0.1% ~ +0.6%' : score >= 45 ? '-0.3% ~ +0.3%' : score >= 35 ? '-0.8% ~ -0.1%' : '-1.3% ~ -0.5%'
  const kosdaqRange =
    score >= 72 ? '+0.7% ~ +1.5%' : score >= 62 ? '+0.2% ~ +0.9%' : score >= 45 ? '-0.5% ~ +0.5%' : score >= 35 ? '-1.1% ~ -0.2%' : '-1.8% ~ -0.7%'
  const watchSymbols = Array.from(
    new Set([
      ...signals.flatMap((signal) => signal.relatedSymbols),
      ...(topPositive?.symbol === 'SOX' || topRisk?.symbol === 'SOX' ? ['005930', '000660'] : []),
    ]),
  ).slice(0, 8)
  const summary =
    topSignal && topSignal.impact !== 0
      ? `${topSignal.symbol} ${formatChange(topSignal.change)}가 가장 큰 신호입니다. ${topRisk ? `${topRisk.symbol} 부담을 같이 확인해야 합니다.` : '장 초반 주도주 확산 여부가 핵심입니다.'}`
      : '미국 선행지표는 뚜렷한 한 방향보다 중립에 가깝습니다. 장 시작 직후 외국인 수급과 환율을 확인해야 합니다.'
  const playbook = [
    topPositive ? `${topPositive.symbol} 강도가 유지되면 관련 종목만 분할 접근` : '상방 신호가 약하면 첫 매수는 30분 뒤로 지연',
    topRisk ? `${topRisk.symbol} 부담이 커지면 신규 매수보다 보유 리스크 축소 우선` : '환율과 VIX가 안정적이면 기존 관심종목 트리거 확인',
    '09:00~09:30에는 KOSPI200 선물 외국인 수급과 삼성전자·SK하이닉스 상대강도 확인',
  ]

  return {
    score,
    label,
    tone,
    riskLevel,
    summary,
    openBias,
    kospiRange,
    kosdaqRange,
    signals,
    playbook,
    watchSymbols,
  }
}

type NewsImpactSourceItem = Pick<
  LiveNewsItem,
  'id' | 'keyword' | 'title' | 'source' | 'publishedAt' | 'direction' | 'importance' | 'confidence' | 'relatedSymbols' | 'sectors' | 'expectedImpact'
>

function newsItemImpact(item: Pick<LiveNewsItem, 'importance' | 'confidence' | 'direction'>) {
  const importanceWeight = item.importance === 'high' ? 2 : item.importance === 'medium' ? 1.25 : 0.75
  const confidenceWeight = item.confidence === 'high' ? 1.2 : item.confidence === 'medium' ? 1 : 0.7
  const directionWeight =
    item.direction === 'positive' ? 1 : item.direction === 'negative' ? -1 : item.direction === 'mixed' ? -0.35 : 0

  return directionWeight * importanceWeight * confidenceWeight
}

function fallbackNewsImpactItems(): NewsImpactSourceItem[] {
  const now = new Date().toISOString()

  return keyIssues.map((issue) => ({
    id: issue.id,
    keyword: issue.sectors[0] ?? issue.relatedSymbols[0] ?? '시장',
    title: issue.title,
    source: issue.source,
    publishedAt: now,
    direction: issue.direction,
    importance: issue.importance,
    confidence: issue.confidence,
    relatedSymbols: issue.relatedSymbols,
    sectors: issue.sectors,
    expectedImpact: issue.expectedImpact,
  }))
}

function newsTargetMatchWeight(item: NewsImpactSourceItem, target: { symbol: string; name: string; market: 'KR' | 'US' }) {
  const profile = symbolProfiles[target.symbol]
  const relatedSymbols = new Set(item.relatedSymbols)
  const sectors = new Set(item.sectors)
  const title = item.title.toLocaleLowerCase('ko-KR')
  const keyword = item.keyword.toLocaleLowerCase('ko-KR')
  const name = target.name.toLocaleLowerCase('ko-KR')

  if (relatedSymbols.has(target.symbol) || keyword === name || title.includes(name)) return 1.15
  if (profile?.sector && sectors.has(profile.sector)) return 0.9
  if (profile?.sensitivity.some((symbol) => relatedSymbols.has(symbol) || sectors.has(symbol))) return 0.75
  if (target.market === 'KR' && item.relatedSymbols.some((symbol) => ['KOSPI', 'KOSDAQ', 'USD/KRW'].includes(symbol))) return 0.5
  if (target.market === 'US' && item.relatedSymbols.some((symbol) => ['NQ=F', 'DXY', 'US10Y', 'VIX'].includes(symbol))) return 0.45

  return 0
}

function buildSymbolNewsImpactBoard(
  liveNews: LiveNewsItem[],
  holdingsData: Holding[],
  watchlistData: WatchItem[],
): NewsImpactBoard {
  const newsItems: NewsImpactSourceItem[] = liveNews.length > 0 ? liveNews : fallbackNewsImpactItems()
  const targets = [
    ...holdingsData.map((holding) => ({
      symbol: holding.symbol,
      name: holding.name,
      market: holding.market,
      source: 'holding' as const,
    })),
    ...watchlistData.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      market: item.symbol.length === 6 ? ('KR' as const) : ('US' as const),
      source: 'watchlist' as const,
    })),
  ]

  const items = targets
    .map((target) => {
      const matchedItems = newsItems
        .map((item) => ({ item, weight: newsTargetMatchWeight(item, target) }))
        .filter(({ weight }) => weight > 0)

      if (matchedItems.length === 0) return null

      const weightedItems = matchedItems
        .map(({ item, weight }) => ({
          item,
          weight,
          impact: newsItemImpact(item) * weight,
        }))
        .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
      const score = clamp(Math.round(weightedItems.reduce((sum, entry) => sum + entry.impact, 0) * 16), -100, 100)
      const positiveCount = weightedItems.filter(({ item }) => item.direction === 'positive').length
      const negativeCount = weightedItems.filter(({ item }) => item.direction === 'negative').length
      const mixedCount = weightedItems.filter(({ item }) => item.direction === 'mixed').length
      const highImportanceCount = weightedItems.filter(({ item }) => item.importance === 'high').length
      const direction: Direction =
        positiveCount > 0 && negativeCount > 0 && Math.abs(score) < 24
          ? 'mixed'
          : score > 8
            ? 'positive'
            : score < -8
              ? 'negative'
              : mixedCount > 0
                ? 'mixed'
                : 'neutral'
      const tone: NewsImpactBoard['items'][number]['tone'] = direction === 'positive' ? 'positive' : direction === 'negative' ? 'negative' : direction === 'mixed' ? 'warning' : 'neutral'
      const latestAt = weightedItems
        .map(({ item }) => item.publishedAt)
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
      const topItem = weightedItems[0]?.item
      const catalysts = Array.from(new Set(weightedItems.flatMap(({ item }) => [item.keyword, ...item.sectors]).filter(Boolean))).slice(0, 5)
      const expectedMove =
        score >= 35
          ? '단기 상승 재료가 우세합니다. 갭상승 후에도 거래대금이 붙는지 확인합니다.'
          : score >= 12
            ? '우호 뉴스가 더 많습니다. 지수 대비 강하면 보유/관심 유지 쪽입니다.'
            : score <= -35
              ? '부담 이슈가 우세합니다. 장 초반 반등 실패 시 리스크 관리가 먼저입니다.'
              : score <= -12
                ? '부정 뉴스 압력이 있습니다. 신규 진입은 확인 후로 미룹니다.'
                : direction === 'mixed'
                  ? '뉴스 방향이 엇갈립니다. 기사보다 가격 반응과 거래량 확인이 우선입니다.'
                  : '뚜렷한 뉴스 우위는 약합니다. 다른 지표와 함께 확인합니다.'
      const suggestedAction =
        direction === 'positive'
          ? target.source === 'holding'
            ? '지수보다 강하면 보유 유지, 급등 추격은 09:30 이후 거래량으로 필터링합니다.'
            : '관심가 근처에서 거래량이 붙을 때만 분할 접근합니다.'
          : direction === 'negative'
            ? target.source === 'holding'
              ? '첫 반등 실패 시 비중 축소 기준과 손절선을 다시 확인합니다.'
              : '신규 진입은 보류하고 뉴스 해소 또는 가격 안정 신호를 기다립니다.'
            : '방향 확정 전까지 주문보다 관찰을 우선합니다.'

      return {
        symbol: target.symbol,
        name: target.name,
        market: target.market,
        source: target.source,
        score,
        tone,
        direction,
        issueCount: weightedItems.length,
        positiveCount,
        negativeCount,
        mixedCount,
        highImportanceCount,
        latestAt,
        topKeyword: topItem?.keyword ?? '확인 대기',
        topHeadline: topItem?.title ?? '관련 뉴스 확인 대기',
        expectedMove,
        suggestedAction,
        catalysts,
        relatedNewsIds: weightedItems.map(({ item }) => item.id),
      }
    })
    .filter((item): item is NewsImpactBoard['items'][number] => Boolean(item))
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))

  const uniqueNewsIds = new Set(items.flatMap((item) => item.relatedNewsIds))
  const positiveCount = items.filter((item) => item.direction === 'positive').length
  const negativeCount = items.filter((item) => item.direction === 'negative').length
  const mixedCount = items.filter((item) => item.direction === 'mixed').length
  const topItem = items[0]
  const summary =
    items.length === 0
      ? '아직 보유/관심종목과 직접 연결된 뉴스가 없습니다. 키워드 추가나 뉴스 새로고침 후 다시 확인합니다.'
      : `${topItem.symbol}(${topItem.name}) 뉴스 민감도가 가장 큽니다. ${topItem.expectedMove}`

  return {
    generatedAt: new Date().toISOString(),
    status: liveNews.length > 0 ? 'live' : newsItems.length > 0 ? 'fallback' : 'empty',
    summary,
    totalLinkedNews: uniqueNewsIds.size,
    positiveCount,
    negativeCount,
    mixedCount,
    hotSymbols: items.slice(0, 5).map((item) => item.symbol),
    items,
  }
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

const catalystBucketLabel: Record<CatalystBucket, string> = {
  now: '즉시',
  today: '오늘',
  overnight: '야간',
  upcoming: '다가오는',
}

const catalystSourceLabel: Record<CatalystSource, string> = {
  news: '뉴스',
  calendar: '일정',
  disclosure: '공시',
}

function catalystTone(direction: Direction, score: number): CatalystRadarItem['tone'] {
  if (direction === 'positive') return 'positive'
  if (direction === 'negative') return 'negative'
  if (direction === 'mixed' || score >= 78) return 'warning'
  return 'neutral'
}

function catalystImportanceScore(importance: 'low' | 'medium' | 'high') {
  if (importance === 'high') return 30
  if (importance === 'medium') return 18
  return 8
}

function catalystBucketScore(bucket: CatalystBucket) {
  if (bucket === 'now') return 26
  if (bucket === 'today') return 18
  if (bucket === 'overnight') return 14
  return 6
}

function disclosureDateKey(value: string) {
  if (!/^\d{8}$/.test(value)) return ''
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function newsCatalystBucket(publishedAt: string): CatalystBucket {
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return 'upcoming'
  const ageHours = (Date.now() - date.getTime()) / 3_600_000
  if (ageHours <= 6) return 'now'
  const dateKey = getKstDateKey(date)
  if (dateKey === getKstDateKey()) return 'today'
  return 'upcoming'
}

function calendarCatalystBucket(event: CalendarEvent): CatalystBucket {
  const today = getKstDateKey()
  const tomorrow = addDaysToDateKey(today, 1)
  const dateKey = event.absoluteDate ?? (event.date === '오늘' ? today : event.date === '내일' ? tomorrow : '')

  if (dateKey === today) return event.time >= '16:00' ? 'overnight' : 'today'
  if (dateKey === tomorrow) return 'overnight'
  return 'upcoming'
}

function disclosureCatalystBucket(item: DisclosureItem): CatalystBucket {
  const submittedDate = disclosureDateKey(item.submittedAt)
  if (submittedDate === getKstDateKey()) return 'today'
  if (submittedDate === addDaysToDateKey(getKstDateKey(), -1)) return 'overnight'
  return 'upcoming'
}

function trackedSymbolBoost(symbols: string[], trackedSymbols: Set<string>) {
  if (symbols.some((symbol) => trackedSymbols.has(symbol))) return 16
  if (symbols.some((symbol) => ['SOX', 'NQ=F', 'USD/KRW', 'VIX', 'US10Y', 'KOSPI', 'KOSDAQ'].includes(symbol))) return 8
  return 0
}

function catalystAction(item: Pick<CatalystRadarItem, 'bucket' | 'source' | 'direction' | 'relatedSymbols'>) {
  const symbolText = item.relatedSymbols.slice(0, 2).join(', ') || '관련 종목'
  if (item.bucket === 'now') return `${symbolText} 가격 반응과 거래량을 즉시 확인`
  if (item.source === 'calendar') return '발표 전후 15분은 추격 주문보다 변동성 확인'
  if (item.source === 'disclosure') return `${symbolText} 공시 원문과 장 초반 갭 반응 확인`
  if (item.direction === 'positive') return `${symbolText}이 지수보다 강한지 확인 후 분할 접근`
  if (item.direction === 'negative') return `${symbolText} 신규 진입 보류, 반등 실패 시 방어`
  return `${symbolText} 방향 확정 전까지 관찰 우선`
}

function buildCatalystRadar({
  liveNews,
  calendarEventsData,
  disclosures,
  holdingsData,
  watchlistData,
}: {
  liveNews: LiveNewsItem[]
  calendarEventsData: CalendarEvent[]
  disclosures: DisclosureItem[]
  holdingsData: Holding[]
  watchlistData: WatchItem[]
}): CatalystRadar {
  const trackedSymbols = new Set([...holdingsData.map((holding) => holding.symbol), ...watchlistData.map((item) => item.symbol)])
  const newsItems: NewsImpactSourceItem[] = liveNews.length > 0 ? liveNews : fallbackNewsImpactItems()
  const newsCatalysts = newsItems.slice(0, 10).map((item) => {
    const bucket = newsCatalystBucket(item.publishedAt)
    const score = clamp(Math.round(Math.abs(newsItemImpact(item)) * 20 + catalystImportanceScore(item.importance) + catalystBucketScore(bucket) + trackedSymbolBoost(item.relatedSymbols, trackedSymbols)), 0, 100)
    const catalyst: CatalystRadarItem = {
      id: `news-${item.id}`,
      source: 'news',
      bucket,
      timeLabel: formatNewsTime(item.publishedAt),
      title: item.title,
      summary: item.expectedImpact,
      score,
      direction: item.direction,
      tone: catalystTone(item.direction, score),
      importance: item.importance,
      relatedSymbols: item.relatedSymbols.length > 0 ? item.relatedSymbols : [item.keyword],
      action: '',
    }
    return { ...catalyst, action: catalystAction(catalyst) }
  })
  const calendarCatalysts = calendarEventsData.slice(0, 12).map((event) => {
    const bucket = calendarCatalystBucket(event)
    const score = clamp(catalystImportanceScore(event.importance) + catalystBucketScore(bucket) + trackedSymbolBoost(event.relatedSymbols, trackedSymbols) + (event.type === 'macro' || event.type === 'policy' ? 12 : 6), 0, 100)
    const direction: Direction = event.type === 'macro' || event.type === 'policy' ? 'mixed' : event.importance === 'high' ? 'mixed' : 'neutral'
    const catalyst: CatalystRadarItem = {
      id: `calendar-${event.id}`,
      source: 'calendar',
      bucket,
      timeLabel: `${event.date} ${event.time}`,
      title: event.title,
      summary: event.description ?? '발표 전후 변동성 확대 가능성이 있는 일정입니다.',
      score,
      direction,
      tone: catalystTone(direction, score),
      importance: event.importance,
      relatedSymbols: event.relatedSymbols,
      action: '',
    }
    return { ...catalyst, action: catalystAction(catalyst) }
  })
  const disclosureCatalysts = disclosures.slice(0, 8).map((item) => {
    const bucket = disclosureCatalystBucket(item)
    const rawImpact = disclosureImpact(item)
    const score = clamp(Math.abs(rawImpact) * 4 + catalystImportanceScore(item.importance) + catalystBucketScore(bucket) + trackedSymbolBoost([item.symbol, item.sector], trackedSymbols), 0, 100)
    const catalyst: CatalystRadarItem = {
      id: `disclosure-${item.id}`,
      source: 'disclosure',
      bucket,
      timeLabel: formatDisclosureDate(item.submittedAt),
      title: `${item.corpName} ${item.reportName}`,
      summary: item.expectedImpact,
      score,
      direction: item.direction,
      tone: catalystTone(item.direction, score),
      importance: item.importance,
      relatedSymbols: [item.symbol, item.sector],
      action: '',
    }
    return { ...catalyst, action: catalystAction(catalyst) }
  })
  const bucketRank: Record<CatalystBucket, number> = { now: 0, today: 1, overnight: 2, upcoming: 3 }
  const items = [...newsCatalysts, ...calendarCatalysts, ...disclosureCatalysts]
    .sort((left, right) => bucketRank[left.bucket] - bucketRank[right.bucket] || right.score - left.score)
    .slice(0, 18)
  const buckets: CatalystRadar['buckets'] = {
    now: items.filter((item) => item.bucket === 'now'),
    today: items.filter((item) => item.bucket === 'today'),
    overnight: items.filter((item) => item.bucket === 'overnight'),
    upcoming: items.filter((item) => item.bucket === 'upcoming'),
  }
  const topItem = items[0]
  const sourceCounts = items.reduce<Record<CatalystSource, number>>(
    (acc, item) => {
      acc[item.source] += 1
      return acc
    },
    { news: 0, calendar: 0, disclosure: 0 },
  )
  const topSource = (Object.entries(sourceCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'none') as CatalystRadar['topSource']
  const topSymbols = Array.from(new Set(items.flatMap((item) => item.relatedSymbols))).filter(Boolean).slice(0, 8)
  const urgentCount = items.filter((item) => item.bucket === 'now' || item.bucket === 'today').length
  const highImportanceCount = items.filter((item) => item.importance === 'high' || item.score >= 80).length

  return {
    generatedAt: new Date().toISOString(),
    summary: topItem
      ? `${catalystBucketLabel[topItem.bucket]} 촉매는 ${topItem.title}입니다. ${topItem.action}`
      : '현재 확인된 뉴스, 공시, 일정 촉매가 없습니다. 데이터 새로고침 후 다시 확인합니다.',
    totalCount: items.length,
    urgentCount,
    highImportanceCount,
    topSource,
    topSymbols,
    buckets,
    items,
  }
}

const marketPulseSourceLabel: Record<MarketPulseSource, string> = {
  indicator: '선행지표',
  news: '뉴스',
  calendar: '일정',
  disclosure: '공시',
  alert: '알림',
}

const marketPulseHorizonLabel: Record<MarketPulseHorizon, string> = {
  now: '즉시',
  preopen: '개장 전',
  session: '장중',
  overnight: '야간/내일',
}

const leadingIndicatorPulseWeight: Record<string, number> = {
  SOX: 18,
  'NQ=F': 16,
  'USD/KRW': 16,
  VIX: 16,
  US10Y: 13,
  DXY: 11,
  KOSPI: 9,
  KOSDAQ: 9,
  'ES=F': 8,
}

function marketPulseHorizonFromCatalyst(bucket: CatalystBucket): MarketPulseHorizon {
  if (bucket === 'now') return 'now'
  if (bucket === 'today') return 'preopen'
  return 'overnight'
}

function marketPulseTone(direction: Direction, impactScore: number): MarketPulseItem['tone'] {
  if (direction === 'positive') return 'positive'
  if (direction === 'negative') return 'negative'
  if (direction === 'mixed' || impactScore >= 72) return 'warning'
  return 'neutral'
}

function marketPulseScores(direction: Direction, impactScore: number) {
  if (direction === 'positive') return { opportunityScore: impactScore, pressureScore: 0 }
  if (direction === 'negative') return { opportunityScore: 0, pressureScore: impactScore }
  if (direction === 'mixed') {
    return {
      opportunityScore: Math.round(impactScore * 0.42),
      pressureScore: Math.round(impactScore * 0.62),
    }
  }
  return {
    opportunityScore: Math.round(impactScore * 0.18),
    pressureScore: Math.round(impactScore * 0.18),
  }
}

function aggregateMarketPulse(scores: number[]) {
  const ranked = scores.filter((score) => score > 0).sort((left, right) => right - left)
  return clamp(Math.round((ranked[0] ?? 0) + (ranked[1] ?? 0) * 0.35 + (ranked[2] ?? 0) * 0.2 + Math.max(0, ranked.length - 3) * 3), 0, 100)
}

function indicatorPulseAction(indicator: MarketIndicator) {
  if (indicator.direction === 'positive') return `${indicator.symbol} 강세가 국내 대형주로 이어지는지 첫 30분 상대강도를 확인`
  if (indicator.direction === 'negative') return `${indicator.symbol} 부담이 커졌으니 관련 고비중 종목 신규 진입은 수급 확인 뒤 판단`
  if (indicator.direction === 'mixed') return `${indicator.symbol} 방향이 엇갈리므로 가격 반응을 먼저 확인`
  return `${indicator.symbol}은 기준선으로 두고 뉴스·환율 변화를 같이 확인`
}

function buildIndicatorPulseItems(indicators: MarketIndicator[]): MarketPulseItem[] {
  return indicators
    .filter((indicator) => Math.abs(indicator.change) >= 0.05 || indicator.symbol in leadingIndicatorPulseWeight)
    .map((indicator) => {
      const impactScore = clamp(Math.round(Math.abs(indicator.change) * 8 + (leadingIndicatorPulseWeight[indicator.symbol] ?? 6)), 4, 100)
      const scores = marketPulseScores(indicator.direction, impactScore)

      const pulse: MarketPulseItem = {
        id: `indicator-pulse-${indicator.symbol}`,
        source: 'indicator',
        horizon: 'now',
        timeLabel: '실시간',
        title: `${indicator.symbol} ${formatChange(indicator.change)}`,
        summary: indicator.note,
        direction: indicator.direction,
        tone: marketPulseTone(indicator.direction, impactScore),
        impactScore,
        ...scores,
        evidence: `${indicator.name} · ${indicator.value}`,
        action: indicatorPulseAction(indicator),
        relatedSymbols: [indicator.symbol],
      }

      return pulse
    })
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 8)
}

function buildCatalystPulseItems(radar: CatalystRadar): MarketPulseItem[] {
  return radar.items.map((item) => {
    const scores = marketPulseScores(item.direction, item.score)

    return {
      id: `catalyst-pulse-${item.id}`,
      source: item.source,
      horizon: marketPulseHorizonFromCatalyst(item.bucket),
      timeLabel: item.timeLabel,
      title: item.title,
      summary: item.summary,
      direction: item.direction,
      tone: marketPulseTone(item.direction, item.score),
      impactScore: item.score,
      ...scores,
      evidence: `${catalystSourceLabel[item.source]} · ${importanceLabel[item.importance]}`,
      action: item.action,
      relatedSymbols: item.relatedSymbols,
    }
  })
}

function buildAlertPulseItems(alerts: TriggeredAlert[]): MarketPulseItem[] {
  return alerts.slice(0, 6).map((alert) => {
    const impactScore = clamp(34 + severityRank(alert.severity) * 15, 0, 100)
    const scores = marketPulseScores('negative', impactScore)

    return {
      id: `alert-pulse-${alert.id}`,
      source: 'alert',
      horizon: 'now',
      timeLabel: '발동',
      title: alert.title,
      summary: alert.summary,
      direction: 'negative',
      tone: alert.severity === 'critical' || alert.severity === 'high' ? 'negative' : 'warning',
      impactScore,
      ...scores,
      evidence: alert.evidence,
      action: '알림 조건이 발동됐으니 해당 종목/지표의 가격 반응과 기존 계획을 먼저 대조',
      relatedSymbols: alert.relatedSymbols,
    }
  })
}

function buildMarketPulseRail({
  indicators,
  radar,
  alerts,
}: {
  indicators: MarketIndicator[]
  radar: CatalystRadar
  alerts: TriggeredAlert[]
}): MarketPulseRail {
  const horizonRank: Record<MarketPulseHorizon, number> = { now: 0, preopen: 1, session: 2, overnight: 3 }
  const items = [...buildAlertPulseItems(alerts), ...buildIndicatorPulseItems(indicators), ...buildCatalystPulseItems(radar)]
    .sort((left, right) => horizonRank[left.horizon] - horizonRank[right.horizon] || right.impactScore - left.impactScore)
    .slice(0, 18)
  const opportunityScore = aggregateMarketPulse(items.map((item) => item.opportunityScore))
  const pressureScore = aggregateMarketPulse(items.map((item) => item.pressureScore))
  const netScore = clamp(opportunityScore - pressureScore, -100, 100)
  const tone: MarketPulseRail['tone'] = netScore >= 18 ? 'positive' : netScore <= -18 ? 'negative' : pressureScore >= 70 || opportunityScore >= 70 ? 'warning' : 'neutral'
  const topItem = items[0]
  const urgentCount = items.filter((item) => (item.horizon === 'now' || item.horizon === 'preopen') && item.impactScore >= 65).length
  const topSymbols = Array.from(new Set(items.flatMap((item) => item.relatedSymbols))).filter(Boolean).slice(0, 8)
  const summary =
    netScore <= -18
      ? `압박 지수가 기회 지수보다 ${Math.abs(netScore)}점 높습니다. ${topItem ? `${topItem.title}부터 확인하세요.` : '장전에는 신규 진입보다 방어 조건 확인이 먼저입니다.'}`
      : netScore >= 18
        ? `기회 지수가 압박 지수보다 ${netScore}점 높습니다. ${topItem ? `${topItem.title}가 핵심 신호입니다.` : '강한 종목만 선별할 수 있는 구간입니다.'}`
        : `기회와 압박이 비슷합니다. ${topItem ? `${topItem.title}의 실제 가격 반응을 먼저 보세요.` : '첫 30분 수급 확인이 중요합니다.'}`
  const playbook = uniqueBriefItems(
    [
      topItem?.action,
      pressureScore >= 70 ? '압박 지수 70 이상이면 보유 비중 큰 종목의 추가 매수는 보류합니다.' : null,
      opportunityScore >= 70 ? '기회 지수 70 이상이어도 지수보다 강한 종목만 분할 접근합니다.' : null,
      urgentCount > 0 ? `즉시 확인 이벤트 ${urgentCount}개는 장 시작 전 가격/거래량 반응을 기록합니다.` : null,
      topSymbols.length > 0 ? `${topSymbols.slice(0, 4).join(', ')}를 우선 감시 심볼로 둡니다.` : null,
    ],
    4,
  )

  return {
    generatedAt: new Date().toISOString(),
    summary,
    netScore,
    tone,
    opportunityScore,
    pressureScore,
    urgentCount,
    topSymbols,
    playbook,
    items,
  }
}

function marketSessionTone(phase: MarketSessionPhase, marketPulse: MarketPulseRail, dataFreshness: DataFreshness): MarketSessionControl['tone'] {
  if (phase === 'closed') return 'neutral'
  if (dataFreshness.staleCount > 0 || dataFreshness.missingCount > 1) return 'warning'
  if (marketPulse.pressureScore >= 76) return 'negative'
  if (marketPulse.opportunityScore >= 76 && marketPulse.netScore > 12) return 'positive'
  if (marketPulse.pressureScore >= 62 || marketPulse.opportunityScore >= 62) return 'warning'
  return 'neutral'
}

function marketSessionTradeMode(phase: MarketSessionPhase, forecast: MarketForecast, marketPulse: MarketPulseRail) {
  if (phase === 'closed') return '다음 거래일 준비'
  if (phase === 'aftermarket') return '복기/저장 우선'
  if (phase === 'closing') return '마감 리스크 정리'
  if (marketPulse.pressureScore >= 76 || forecast.baseScore <= 38) return '방어 우선'
  if (marketPulse.opportunityScore >= 76 && forecast.baseScore >= 58) return '선별 공격'
  if (phase === 'opening') return '첫 30분 관찰'
  return '확인 후 대응'
}

function sessionTask(
  id: string,
  title: string,
  summary: string,
  priority: ActionQueueItem['priority'],
  tone: MarketSessionTask['tone'],
  evidence: string,
): MarketSessionTask {
  return { id, title, summary, priority, tone, evidence }
}

function sessionTaskToneFromPriority(priority: ActionQueueItem['priority']): MarketSessionTask['tone'] {
  const variant = actionPriorityVariant(priority)
  return variant === 'secondary' ? 'neutral' : variant
}

function buildBaseSessionTasks({
  phase,
  marketPulse,
  dataFreshness,
  forecast,
  portfolioPlaybook,
  forecastReview,
}: {
  phase: MarketSessionPhase
  marketPulse: MarketPulseRail
  dataFreshness: DataFreshness
  forecast: MarketForecast
  portfolioPlaybook: PortfolioPlaybook
  forecastReview: ForecastReview
}) {
  const topPulse = marketPulse.items[0]
  const staleTask =
    dataFreshness.staleCount > 0 || dataFreshness.missingCount > 0
      ? [
          sessionTask(
            'freshness-refresh',
            '데이터 최신성 먼저 확인',
            `${dataFreshness.staleCount}개 갱신 필요, ${dataFreshness.missingCount}개 수신 전입니다. 판단 전에 전체 새로고침을 실행합니다.`,
            dataFreshness.staleCount > 0 ? 'high' : 'medium',
            'warning',
            dataFreshness.label,
          ),
        ]
      : []
  const pulseTask = topPulse
    ? [
        sessionTask(
          `pulse-${topPulse.id}`,
          topPulse.title,
          topPulse.action,
          topPulse.impactScore >= 80 ? 'high' : 'medium',
          topPulse.tone,
          `${marketPulseSourceLabel[topPulse.source]} · ${topPulse.impactScore}점`,
        ),
      ]
    : []

  if (phase === 'overnight') {
    return [
      ...staleTask,
      ...pulseTask,
      sessionTask('overnight-index', '미국 선행지표 마감 방향 확인', 'NQ=F, SOX, VIX, USD/KRW가 같은 방향인지 확인하고 국내 반도체/성장주 민감도를 정리합니다.', 'high', 'warning', `순충격 ${marketPulse.netScore}`),
      sessionTask('overnight-brief', '장전 브리핑 초안 준비', forecast.summary, 'medium', directionVariant(forecast.baseScore >= 55 ? 'positive' : forecast.baseScore <= 45 ? 'negative' : 'neutral'), `방향점수 ${forecast.baseScore}/100`),
    ]
  }
  if (phase === 'preopen') {
    return [
      ...staleTask,
      ...pulseTask,
      sessionTask('preopen-command', '08:45 장전 운전석 확인', '장전 운전석, 시장 충격 레일, 액션 큐를 보고 신규 진입/보류 조건을 확정합니다.', 'high', marketPulse.pressureScore >= 70 ? 'negative' : 'warning', marketPulse.summary),
      sessionTask('preopen-portfolio', '고비중 보유종목 첫 가격 기준 잡기', `${portfolioPlaybook.topExposureLabel} 노출과 포지션별 행동 기준을 확인합니다.`, 'medium', portfolioPlaybook.stance === 'defensive' ? 'negative' : 'neutral', portfolioPlaybook.stanceLabel),
    ]
  }
  if (phase === 'opening') {
    return [
      ...pulseTask,
      sessionTask('opening-no-chase', '첫 30분 추격 매수 금지', '시초가 갭보다 09:30 전후 상대강도와 거래량을 먼저 확인합니다.', 'critical', marketPulse.pressureScore >= 70 ? 'negative' : 'warning', '09:00-09:30'),
      sessionTask('opening-leaders', '주도주와 보유종목 괴리 확인', 'KOSPI/KOSDAQ 대비 보유 대형주와 관심 성장주가 더 강한지 비교합니다.', 'high', 'neutral', forecast.openingBias),
    ]
  }
  if (phase === 'session') {
    return [
      ...pulseTask,
      sessionTask('session-alerts', '알림과 액션 큐 재정렬', '가격/등락률/뉴스 조건이 새로 발동됐는지 보고 기존 계획과 충돌하는 항목을 정리합니다.', 'medium', 'neutral', '장중 추적'),
      sessionTask('session-risk', '추가 매수는 데이터 신뢰도 확인 후', '데이터 최신성 기준 안에 있는지 확인하고, 방향점수와 실제 지수 흐름이 어긋나면 대기합니다.', 'medium', dataFreshness.tone, dataFreshness.label),
    ]
  }
  if (phase === 'closing') {
    return [
      sessionTask('closing-risk', '마감 전 비중 리스크 정리', '내일로 넘길 리스크와 당일 새로 생긴 공시/뉴스를 분리해 기록합니다.', 'high', portfolioPlaybook.stance === 'defensive' ? 'negative' : 'warning', portfolioPlaybook.stanceLabel),
      sessionTask('closing-review-ready', '장후 리뷰 기준 저장', '방향점수, 실제 지수 흐름, 놓친 촉매를 장후 리뷰에 바로 옮길 준비를 합니다.', 'medium', forecastReview.tone, forecastReview.label),
    ]
  }
  if (phase === 'aftermarket') {
    return [
      sessionTask('after-review', '예측 검증 리포트 작성', forecastReview.reviewDraft, 'high', forecastReview.tone, forecastReview.actualLabel),
      sessionTask('after-archive', '투자노트와 복기 히스토리 저장', '오늘 실행률, 장전 계획, 장후 리뷰를 저장해 다음 거래일 판단 근거로 남깁니다.', 'medium', 'positive', '장후 루틴'),
    ]
  }

  return [
    sessionTask('closed-prepare', '다음 거래일 관심 변수 정리', '보유/관심종목, 뉴스 키워드, 개인 캘린더를 정리하고 동기화/백업 상태를 확인합니다.', 'medium', 'neutral', '휴장'),
    sessionTask('closed-watch', '미국 선행지표와 다음 이벤트 확인', '다음 거래일 전까지 NQ=F, SOX, 환율, 금리, 캘린더 이벤트를 우선 감시합니다.', 'medium', 'neutral', '다음 평일'),
  ]
}

function buildMarketSessionControl({
  now,
  forecast,
  marketPulse,
  actionQueue,
  dataFreshness,
  executionPlan,
  portfolioPlaybook,
  forecastReview,
}: {
  now: Date
  forecast: MarketForecast
  marketPulse: MarketPulseRail
  actionQueue: ActionQueueItem[]
  dataFreshness: DataFreshness
  executionPlan: ExecutionPlan
  portfolioPlaybook: PortfolioPlaybook
  forecastReview: ForecastReview
}): MarketSessionControl {
  const phase = resolveMarketSessionPhase(now)
  const topActionTasks = actionQueue.slice(0, 2).map((item) =>
    sessionTask(
      `action-${item.id}`,
      item.title,
      item.suggestedAction,
      item.priority,
      sessionTaskToneFromPriority(item.priority),
      item.evidence,
    ),
  )
  const tasks = [...buildBaseSessionTasks({ phase: phase.phase, marketPulse, dataFreshness, forecast, portfolioPlaybook, forecastReview }), ...topActionTasks]
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority))
    .slice(0, 6)
  const focusSymbols = Array.from(
    new Set([...marketPulse.topSymbols, ...actionQueue.flatMap((item) => item.relatedSymbols), ...executionPlan.items.map((item) => item.symbol)]),
  )
    .filter(Boolean)
    .slice(0, 8)
  const guardrails = Array.from(
    new Set([
      ...executionPlan.guardrails,
      marketPulse.pressureScore >= 70 ? '압박 지수 70 이상이면 신규 진입보다 보유 리스크 확인을 우선합니다.' : null,
      dataFreshness.staleCount > 0 ? '데이터 갱신 필요 상태에서는 예측 강도를 한 단계 낮춰 봅니다.' : null,
      phase.phase === 'opening' ? '09:30 전에는 관심가 도달만으로 진입하지 않습니다.' : null,
    ].filter((item): item is string => Boolean(item))),
  ).slice(0, 5)
  const tone = marketSessionTone(phase.phase, marketPulse, dataFreshness)
  const tradeMode = marketSessionTradeMode(phase.phase, forecast, marketPulse)

  return {
    generatedAt: now.toISOString(),
    kstTimeLabel: formatKstTimeLabel(now),
    phase: phase.phase,
    phaseLabel: phase.phaseLabel,
    tone,
    summary: `${phase.phaseLabel} 단계입니다. 현재 모드는 ${tradeMode}, 다음 체크포인트는 ${phase.nextCheckpointLabel}(${formatMinutesUntil(phase.minutesToNext)})입니다.`,
    nextCheckpointLabel: phase.nextCheckpointLabel,
    nextCheckpointTimeLabel: phase.nextCheckpointTimeLabel,
    minutesToNext: phase.minutesToNext,
    tradeMode,
    focusSymbols,
    tasks,
    guardrails,
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

function sensitivityScoreLabel(score: number) {
  if (score >= 62) return '상방 우위'
  if (score <= 43) return '방어 전환'
  return '중립권'
}

function indicatorUpsideTrigger(signal: KoreaMarketBridge['signals'][number]) {
  if (signal.impact < 0) return `${signal.symbol} 부담이 절반 이하로 줄거나 플러스 전환`
  if (signal.impact > 0) return `${signal.symbol} 우호 흐름이 장 시작 전까지 유지`
  return `${signal.symbol} 방향이 우호 쪽으로 확정`
}

function indicatorDownsideTrigger(signal: KoreaMarketBridge['signals'][number]) {
  if (signal.impact > 0) return `${signal.symbol} 우호 신호가 꺾이거나 음전`
  if (signal.impact < 0) return `${signal.symbol} 부담이 추가 확대`
  return `${signal.symbol}이 부담 방향으로 확정`
}

function buildForecastSensitivity({
  forecast,
  koreaMarketBridge,
  newsImpactBoard,
  portfolioPlaybook,
}: {
  forecast: MarketForecast
  koreaMarketBridge: KoreaMarketBridge
  newsImpactBoard: NewsImpactBoard
  portfolioPlaybook: PortfolioPlaybook
}): ForecastSensitivity {
  const indicatorFactors = koreaMarketBridge.signals.slice(0, 6).map((signal) => {
    const currentImpact = clamp(Math.round(signal.impact * 0.55), -28, 28)
    const upsideDelta =
      signal.impact < 0
        ? clamp(Math.round(Math.abs(signal.impact) * 0.65 + 6), 4, 26)
        : clamp(Math.round(signal.weight * 0.25 + Math.max(2, signal.impact * 0.18)), 3, 16)
    const downsideDelta =
      signal.impact > 0
        ? -clamp(Math.round(signal.impact * 0.7 + 5), 4, 26)
        : -clamp(Math.round(Math.abs(signal.impact) * 0.35 + 4), 3, 18)

    return {
      id: `sensitivity-${signal.symbol}`,
      label: signal.name,
      symbol: signal.symbol,
      category: 'indicator' as const,
      currentImpact,
      upsideDelta,
      downsideDelta,
      tone: signal.tone,
      upsideTrigger: indicatorUpsideTrigger(signal),
      downsideTrigger: indicatorDownsideTrigger(signal),
      note: signal.confirmation,
      watchSymbols: signal.relatedSymbols,
    }
  })
  const topNewsItems = newsImpactBoard.items.slice(0, 4).map((item) => {
    const currentImpact = clamp(Math.round(item.score / 4), -24, 24)
    const upsideDelta =
      item.score < 0
        ? clamp(Math.round(Math.abs(item.score) / 5 + 5), 4, 22)
        : clamp(Math.round(item.score / 8 + item.highImportanceCount), 3, 18)
    const downsideDelta =
      item.score > 0
        ? -clamp(Math.round(item.score / 6 + 5), 4, 24)
        : -clamp(Math.round(Math.abs(item.score) / 8 + item.highImportanceCount), 3, 18)

    return {
      id: `sensitivity-news-${item.source}-${item.symbol}`,
      label: `${item.name} 뉴스`,
      symbol: item.symbol,
      category: 'news' as const,
      currentImpact,
      upsideDelta,
      downsideDelta,
      tone: item.tone,
      upsideTrigger: item.score < 0 ? `${item.name} 부담 뉴스 해소 또는 반박 기사 확인` : `${item.name} 우호 뉴스에 가격·거래량 동반`,
      downsideTrigger: item.score > 0 ? `${item.name} 우호 뉴스가 재료 소멸로 바뀌는지 확인` : `${item.name} 부정 뉴스가 추가 확산`,
      note: item.expectedMove,
      watchSymbols: [item.symbol, ...item.catalysts].slice(0, 6),
    }
  })
  const portfolioRisk = portfolioPlaybook.riskSignals[0]
  const portfolioFactor: ForecastSensitivity['factors'] = portfolioRisk
    ? [
        {
          id: `sensitivity-portfolio-${portfolioRisk.id}`,
          label: portfolioRisk.title,
          symbol: portfolioRisk.relatedSymbols[0] ?? 'PORT',
          category: 'portfolio' as const,
          currentImpact: portfolioRisk.severity === 'critical' ? -18 : portfolioRisk.severity === 'high' ? -13 : -8,
          upsideDelta: portfolioRisk.severity === 'critical' ? 14 : portfolioRisk.severity === 'high' ? 10 : 7,
          downsideDelta: portfolioRisk.severity === 'critical' ? -18 : portfolioRisk.severity === 'high' ? -13 : -8,
          tone: portfolioRisk.severity === 'critical' || portfolioRisk.severity === 'high' ? 'negative' : 'warning',
          upsideTrigger: `${portfolioRisk.title} 리스크가 완화되는지 확인`,
          downsideTrigger: `${portfolioRisk.title} 리스크가 가격에 반영되는지 확인`,
          note: portfolioRisk.suggestedAction,
          watchSymbols: portfolioRisk.relatedSymbols,
        },
      ]
    : []
  const factors = [...indicatorFactors, ...topNewsItems, ...portfolioFactor]
    .sort((left, right) => Math.max(Math.abs(right.upsideDelta), Math.abs(right.downsideDelta)) - Math.max(Math.abs(left.upsideDelta), Math.abs(left.downsideDelta)))
    .slice(0, 10)
  const upsideFactors = [...factors].sort((left, right) => right.upsideDelta - left.upsideDelta)
  const downsideFactors = [...factors].sort((left, right) => Math.abs(right.downsideDelta) - Math.abs(left.downsideDelta))
  const topUpsideFactor = upsideFactors[0]
  const topDownsideFactor = downsideFactors.find((factor) => factor.id !== topUpsideFactor?.id) ?? downsideFactors[0]
  const upsideTarget = 62
  const downsideTarget = 43
  const upsideGap = Math.max(0, upsideTarget - forecast.baseScore)
  const downsideGap = Math.max(0, forecast.baseScore - downsideTarget)
  const summary =
    upsideGap === 0
      ? `${sensitivityScoreLabel(forecast.baseScore)} 상태입니다. 상방 유지에는 ${topDownsideFactor?.symbol ?? '핵심 변수'} 이탈 여부가 중요합니다.`
      : downsideGap === 0
        ? `${sensitivityScoreLabel(forecast.baseScore)} 상태입니다. 방어 해제에는 ${topUpsideFactor?.symbol ?? '핵심 변수'} 개선이 필요합니다.`
        : `상방 전환까지 ${upsideGap}점, 방어 전환까지 ${downsideGap}점 남았습니다. ${topUpsideFactor?.symbol ?? '상방 변수'}와 ${topDownsideFactor?.symbol ?? '하방 변수'}를 먼저 봅니다.`
  const transitionChecklist = [
    topUpsideFactor ? `상방 전환: ${topUpsideFactor.upsideTrigger}` : '상방 전환: NQ/SOX 유지와 환율 안정 확인',
    topDownsideFactor ? `하방 전환: ${topDownsideFactor.downsideTrigger}` : '하방 전환: 환율, VIX, 금리 급등 여부 확인',
    '전환 신호가 나오면 09:00~09:30 대장주 상대강도와 외국인 선물 수급으로 재확인',
  ]

  return {
    generatedAt: new Date().toISOString(),
    baseScore: forecast.baseScore,
    upsideTarget,
    downsideTarget,
    upsideGap,
    downsideGap,
    summary,
    topUpsideFactor: topUpsideFactor?.symbol ?? '확인 대기',
    topDownsideFactor: topDownsideFactor?.symbol ?? '확인 대기',
    factors,
    transitionChecklist,
  }
}

function getSymbolProfile(symbol: string, name: string) {
  const normalized = symbol.toUpperCase()
  const knownProfile = symbolProfiles[normalized]
  if (knownProfile) return knownProfile

  if (/^\d{6}$/.test(normalized)) {
    return {
      sector: name.includes('반도체') ? '반도체' : '국내 기타',
      sensitivity: ['USD/KRW', 'KOSPI'],
    }
  }

  return {
    sector: name.includes('AI') ? 'AI/성장' : '미국 기타',
    sensitivity: ['NQ=F', 'DXY'],
  }
}

function holdingMarketValueKrw(holding: Holding, usdKrw: number) {
  const value = holding.currentPrice * holding.quantity
  return holding.market === 'US' ? value * usdKrw : value
}

function indicatorPressure(indicators: MarketIndicator[], symbol: string) {
  const indicator = indicators.find((item) => item.symbol === symbol)
  if (!indicator) return 0

  const signedChange = inverseIndicators.has(symbol) ? -indicator.change : indicator.change
  return signedChange
}

const scenarioShockControls: Array<{
  symbol: ScenarioShockSymbol
  label: string
  min: number
  max: number
  step: number
  weight: number
  limit: number
  note: string
}> = [
  { symbol: 'SOX', label: 'SOX 추가 변화', min: -4, max: 4, step: 0.25, weight: 8, limit: 22, note: '반도체 대형주 민감도' },
  { symbol: 'NQ=F', label: 'NQ 선물 추가 변화', min: -3, max: 3, step: 0.25, weight: 7, limit: 18, note: '성장주와 코스닥 심리' },
  { symbol: 'USD/KRW', label: '달러/원 추가 변화', min: -1.5, max: 1.5, step: 0.1, weight: 6, limit: 14, note: '국내 외국인 수급 부담' },
  { symbol: 'VIX', label: 'VIX 추가 변화', min: -8, max: 8, step: 0.5, weight: 3.5, limit: 12, note: '위험회피 강도' },
  { symbol: 'US10Y', label: '미국 10년물 추가 변화', min: -3, max: 3, step: 0.25, weight: 3, limit: 10, note: '성장주 밸류 부담' },
]

const defaultScenarioShocks: ScenarioShockState = {
  SOX: 0,
  'NQ=F': 0,
  'USD/KRW': 0,
  VIX: 0,
  US10Y: 0,
}

const scenarioPositionSensitivity: Record<string, number> = {
  SOX: 0.55,
  'NQ=F': 0.38,
  'USD/KRW': 0.3,
  VIX: 0.18,
  US10Y: 0.2,
  DXY: 0.18,
  TSLA: 0.42,
  KOSPI: 0.25,
}

function scenarioShockImpact(symbol: string, shock: number, weight: number, limit: number) {
  const adjustedShock = inverseIndicators.has(symbol) ? -shock : shock
  return clamp(round(adjustedShock * weight, 1), -limit, limit)
}

function scenarioFactorNote(symbol: ScenarioShockSymbol, impact: number) {
  if (impact > 0) return `${symbol} 가정은 국내장 점수에 우호적입니다.`
  if (impact < 0) return `${symbol} 가정은 국내장 점수에 부담입니다.`
  return `${symbol} 추가 가정은 중립입니다.`
}

function buildScenarioSimulation({
  forecast,
  holdingsData,
  newsImpactBoard,
  shocks,
  usdKrw,
}: {
  forecast: MarketForecast
  holdingsData: Holding[]
  newsImpactBoard: NewsImpactBoard
  shocks: ScenarioShockState
  usdKrw: number
}): ScenarioSimulationResult {
  const factors = scenarioShockControls.map((control) => {
    const shock = shocks[control.symbol]
    const scoreImpact = scenarioShockImpact(control.symbol, shock, control.weight, control.limit)
    const tone = scoreImpact > 1 ? 'positive' : scoreImpact < -1 ? 'negative' : shock !== 0 ? 'warning' : 'neutral'

    return {
      symbol: control.symbol,
      label: control.label,
      shock,
      scoreImpact,
      tone,
      note: scenarioFactorNote(control.symbol, scoreImpact),
    } satisfies ScenarioSimulationFactor
  })
  const scoreDelta = round(factors.reduce((sum, factor) => sum + factor.scoreImpact, 0), 1)
  const score = clamp(Math.round(forecast.baseScore + scoreDelta), 0, 100)
  const totalShockIntensity = clamp(Object.values(shocks).reduce((sum, shock) => sum + Math.abs(shock), 0) / 8, 0, 1)
  const boardBySymbol = new Map(newsImpactBoard.items.map((item) => [item.symbol, item]))
  const positions = holdingsData
    .map((holding) => {
      const profile = getSymbolProfile(holding.symbol, holding.name)
      const sensitivity = Array.from(new Set([...profile.sensitivity, ...(holding.market === 'KR' ? ['USD/KRW'] : [])]))
      const baseValueKrw = holdingMarketValueKrw(holding, usdKrw)
      const rawImpactPercent = sensitivity.reduce((sum, symbol) => {
        const shock = shocks[symbol as ScenarioShockSymbol] ?? 0
        const adjustedShock = inverseIndicators.has(symbol) ? -shock : shock
        return sum + adjustedShock * (scenarioPositionSensitivity[symbol] ?? 0.12)
      }, 0)
      const currencyTranslation = holding.market === 'US' ? shocks['USD/KRW'] * 0.25 : 0
      const newsTilt = clamp((boardBySymbol.get(holding.symbol)?.score ?? 0) / 240, -0.35, 0.35) * totalShockIntensity
      const impactPercent = round(clamp(rawImpactPercent + currencyTranslation + newsTilt, -7, 7), 2)
      const impactKrw = Math.round(baseValueKrw * (impactPercent / 100))

      return {
        symbol: holding.symbol,
        name: holding.name,
        impactPercent,
        impactKrw,
        tone: stressPositionTone(impactPercent),
        sensitivity,
      } satisfies ScenarioSimulationPosition
    })
    .sort((left, right) => Math.abs(right.impactKrw) - Math.abs(left.impactKrw))
  const totalValueKrw = holdingsData.reduce((sum, holding) => sum + holdingMarketValueKrw(holding, usdKrw), 0)
  const portfolioImpactKrw = positions.reduce((sum, position) => sum + position.impactKrw, 0)
  const portfolioImpactPercent = totalValueKrw > 0 ? round((portfolioImpactKrw / totalValueKrw) * 100, 2) : 0
  const topFactor = [...factors].sort((left, right) => Math.abs(right.scoreImpact) - Math.abs(left.scoreImpact))[0]
  const topPosition = positions[0]
  const scoreTone = stressToneFromScore(score)
  const label = stressLabelFromScore(score)
  const action =
    score <= 43
      ? '신규 매수 보류'
      : score >= 62
        ? '강한 종목만 분할'
        : portfolioImpactPercent < -1
          ? '비중 축소 감시'
          : '첫 30분 확인'
  const summary =
    topFactor && Math.abs(topFactor.scoreImpact) > 0
      ? `${topFactor.symbol} 가정이 ${topFactor.scoreImpact > 0 ? '+' : ''}${topFactor.scoreImpact}점으로 가장 큽니다. ${topPosition ? `${topPosition.symbol} 영향 ${formatChange(topPosition.impactPercent)}를 먼저 봅니다.` : '포트폴리오 영향은 제한적입니다.'}`
      : '추가 가정이 없는 기준 상태입니다. 현재 예측과 스트레스 테스트를 함께 봅니다.'

  return {
    score,
    scoreDelta,
    scoreTone,
    label,
    kospiRange: stressRangeFromScore(score, 'KOSPI'),
    kosdaqRange: stressRangeFromScore(score, 'KOSDAQ'),
    portfolioImpactKrw,
    portfolioImpactPercent,
    summary,
    action,
    factors,
    positions,
  }
}

function stressToneFromScore(score: number): OvernightStressTest['stressTone'] {
  if (score >= 62) return 'positive'
  if (score <= 40) return 'negative'
  if (score <= 50) return 'warning'
  return 'neutral'
}

function stressLabelFromScore(score: number) {
  if (score >= 62) return '충격 흡수'
  if (score >= 51) return '중립 방어'
  if (score >= 41) return '압박 경계'
  return '방어 우선'
}

function stressRangeFromScore(score: number, market: 'KOSPI' | 'KOSDAQ') {
  if (market === 'KOSDAQ') {
    if (score >= 70) return '+0.6% ~ +1.4%'
    if (score >= 62) return '+0.2% ~ +0.9%'
    if (score >= 51) return '-0.3% ~ +0.4%'
    if (score >= 41) return '-1.0% ~ -0.2%'
    return '-1.8% ~ -0.7%'
  }

  if (score >= 70) return '+0.4% ~ +1.0%'
  if (score >= 62) return '+0.1% ~ +0.6%'
  if (score >= 51) return '-0.2% ~ +0.3%'
  if (score >= 41) return '-0.8% ~ -0.1%'
  return '-1.4% ~ -0.5%'
}

function stressPositionTone(impactPercent: number): OvernightStressTest['positions'][number]['tone'] {
  if (impactPercent <= -2.2) return 'negative'
  if (impactPercent <= -0.8) return 'warning'
  if (impactPercent > 0) return 'positive'
  return 'neutral'
}

function stressPositionNote(sensitivity: string[], impactPercent: number) {
  if (sensitivity.includes('SOX')) return `SOX/NQ 추가 약세 때 반도체 민감도 확대, 추정 ${formatChange(impactPercent)}`
  if (sensitivity.includes('USD/KRW')) return `환율 재상승 때 외국인 수급 부담 반영, 추정 ${formatChange(impactPercent)}`
  if (sensitivity.includes('US10Y')) return `금리 상승 때 성장주 밸류 부담 반영, 추정 ${formatChange(impactPercent)}`
  if (sensitivity.includes('DXY')) return `강달러 구간에서 미국 성장주 변동성 반영, 추정 ${formatChange(impactPercent)}`
  return `야간 위험회피 확대 가정, 추정 ${formatChange(impactPercent)}`
}

function buildOvernightStressTest({
  forecast,
  koreaMarketBridge,
  forecastSensitivity,
  newsImpactBoard,
  holdingsData,
  indicators,
  usdKrw,
}: {
  forecast: MarketForecast
  koreaMarketBridge: KoreaMarketBridge
  forecastSensitivity: ForecastSensitivity
  newsImpactBoard: NewsImpactBoard
  holdingsData: Holding[]
  indicators: MarketIndicator[]
  usdKrw: number
}): OvernightStressTest {
  const downsideGapPenalty = forecastSensitivity.downsideGap <= 4 ? 5 : forecastSensitivity.downsideGap <= 10 ? 2 : 0
  const bridgePenalty = koreaMarketBridge.riskLevel === 'high' ? 14 : koreaMarketBridge.riskLevel === 'medium' ? 10 : 7
  const livePressurePenalty =
    Math.max(0, -indicatorPressure(indicators, 'SOX')) * 3.6 +
    Math.max(0, -indicatorPressure(indicators, 'NQ=F')) * 3 +
    Math.max(0, -indicatorPressure(indicators, 'USD/KRW')) * 2.5 +
    Math.max(0, -indicatorPressure(indicators, 'VIX')) * 1.8 +
    Math.max(0, -indicatorPressure(indicators, 'US10Y')) * 1.6
  const stressPenalty = clamp(Math.round(bridgePenalty + livePressurePenalty + downsideGapPenalty), 8, 30)
  const stressScore = clamp(forecast.baseScore - stressPenalty, 0, 100)
  const sensitivityImpact: Record<string, number> = {
    SOX: -1.35,
    'NQ=F': -0.85,
    'USD/KRW': -0.55,
    VIX: -0.45,
    US10Y: -0.4,
    DXY: -0.3,
    TSLA: -0.75,
    KOSPI: -0.45,
  }
  const boardBySymbol = new Map(newsImpactBoard.items.map((item) => [item.symbol, item]))
  const positions = holdingsData
    .map((holding) => {
      const profile = getSymbolProfile(holding.symbol, holding.name)
      const sensitivity = Array.from(new Set([...profile.sensitivity, ...(holding.market === 'KR' ? ['USD/KRW'] : [])]))
      const baseValueKrw = holdingMarketValueKrw(holding, usdKrw)
      const newsScore = boardBySymbol.get(holding.symbol)?.score ?? 0
      const sectorPenalty = profile.sector.includes('반도체') ? -0.45 : profile.sector.includes('배터리') ? -0.35 : profile.sector.includes('인터넷') ? -0.25 : 0
      const marketPenalty = holding.market === 'KR' ? -0.25 : -0.1
      const momentumPenalty = holding.dayChange < -1 ? -0.35 : holding.dayChange > 1 ? 0.15 : 0
      const rawImpactPercent =
        -0.25 +
        sensitivity.reduce((sum, item) => sum + (sensitivityImpact[item] ?? -0.2), 0) +
        sectorPenalty +
        marketPenalty +
        momentumPenalty +
        clamp(newsScore / 85, -1.2, 0.8)
      const stressImpactPercent = round(clamp(rawImpactPercent, -7.5, 2.5), 2)
      const stressImpactKrw = Math.round(baseValueKrw * (stressImpactPercent / 100))

      return {
        symbol: holding.symbol,
        name: holding.name,
        market: holding.market,
        weight: holding.portfolioWeight,
        baseValueKrw,
        stressImpactKrw,
        stressImpactPercent,
        sensitivity,
        note: stressPositionNote(sensitivity, stressImpactPercent),
        tone: stressPositionTone(stressImpactPercent),
      }
    })
    .sort((left, right) => left.stressImpactKrw - right.stressImpactKrw)

  const totalValueKrw = positions.reduce((sum, position) => sum + position.baseValueKrw, 0)
  const portfolioImpactKrw = positions.reduce((sum, position) => sum + position.stressImpactKrw, 0)
  const portfolioImpactPercent = totalValueKrw > 0 ? round((portfolioImpactKrw / totalValueKrw) * 100, 2) : 0
  const maxDrawdownKrw = Math.round(portfolioImpactKrw < 0 ? portfolioImpactKrw * 1.45 : portfolioImpactKrw * 0.35)
  const maxDrawdownPercent = totalValueKrw > 0 ? round((maxDrawdownKrw / totalValueKrw) * 100, 2) : 0
  const topAffectedSymbols = positions.slice(0, 4).map((position) => position.symbol)
  const stabilizeScore = clamp(forecast.baseScore + Math.max(5, Math.round(stressPenalty * 0.45)), 0, 100)
  const mixedScore = clamp(forecast.baseScore - Math.max(4, Math.round(stressPenalty * 0.45)), 0, 100)
  const stabilizationImpactKrw = Math.round(Math.abs(portfolioImpactKrw) * 0.35)
  const mixedImpactKrw = Math.round(portfolioImpactKrw * 0.45)
  const stabilizationImpactPercent = totalValueKrw > 0 ? round((stabilizationImpactKrw / totalValueKrw) * 100, 2) : 0
  const mixedImpactPercent = totalValueKrw > 0 ? round((mixedImpactKrw / totalValueKrw) * 100, 2) : 0
  const affectedLabel = topAffectedSymbols.slice(0, 2).join(', ') || '상위 보유종목'

  return {
    generatedAt: new Date().toISOString(),
    summary: `${koreaMarketBridge.label}에서 야간 악화 가정 시 방향점수는 ${forecast.baseScore}에서 ${stressScore}까지 밀릴 수 있습니다. ${affectedLabel}을 먼저 방어 체크합니다.`,
    baseScore: forecast.baseScore,
    stressScore,
    stressLabel: stressLabelFromScore(stressScore),
    stressTone: stressToneFromScore(stressScore),
    expectedKospiRange: stressRangeFromScore(stressScore, 'KOSPI'),
    expectedKosdaqRange: stressRangeFromScore(stressScore, 'KOSDAQ'),
    portfolioImpactKrw,
    portfolioImpactPercent,
    maxDrawdownKrw,
    maxDrawdownPercent,
    scenarios: [
      {
        id: 'risk-off',
        label: '야간 악화',
        tone: stressToneFromScore(stressScore),
        scoreDelta: stressScore - forecast.baseScore,
        kospiRange: stressRangeFromScore(stressScore, 'KOSPI'),
        kosdaqRange: stressRangeFromScore(stressScore, 'KOSDAQ'),
        portfolioImpactKrw,
        portfolioImpactPercent,
        summary: 'SOX/NQ가 추가 하락하고 환율·VIX 부담이 커지는 경우입니다. 시초가 추격보다 방어 주문을 먼저 봅니다.',
        triggers: ['SOX -1%대 추가 약세', 'NQ=F 음전 또는 낙폭 확대', 'USD/KRW와 VIX 동반 상승'],
        topAffectedSymbols,
      },
      {
        id: 'stabilize',
        label: '안정 회복',
        tone: 'positive',
        scoreDelta: stabilizeScore - forecast.baseScore,
        kospiRange: stressRangeFromScore(stabilizeScore, 'KOSPI'),
        kosdaqRange: stressRangeFromScore(stabilizeScore, 'KOSDAQ'),
        portfolioImpactKrw: stabilizationImpactKrw,
        portfolioImpactPercent: stabilizationImpactPercent,
        summary: 'NQ/SOX가 낙폭을 줄이고 환율이 안정되면 기존 예측보다 우호적인 출발이 가능합니다.',
        triggers: ['SOX와 NQ=F 플러스권 회복', 'USD/KRW 상승폭 축소', 'VIX 하락 전환'],
        topAffectedSymbols: Array.from(new Set([...koreaMarketBridge.watchSymbols, ...topAffectedSymbols])).slice(0, 4),
      },
      {
        id: 'mixed',
        label: '혼조 유지',
        tone: 'warning',
        scoreDelta: mixedScore - forecast.baseScore,
        kospiRange: stressRangeFromScore(mixedScore, 'KOSPI'),
        kosdaqRange: stressRangeFromScore(mixedScore, 'KOSDAQ'),
        portfolioImpactKrw: mixedImpactKrw,
        portfolioImpactPercent: mixedImpactPercent,
        summary: '지수는 버티지만 환율이나 금리 중 하나가 부담으로 남는 경우입니다. 대장주 상대강도 확인 전까지 선별 접근합니다.',
        triggers: ['NQ=F 보합권, SOX 약세', '환율 상승세 지속', '개장 30분 수급 불확실'],
        topAffectedSymbols: topAffectedSymbols.slice(0, 3),
      },
    ],
    positions,
    hedgeChecklist: [
      stressScore <= 43 ? '09:00~09:30 신규 매수 금지, 기존 보유 손절선과 현금 비중부터 확인' : '첫 30분은 대장주 상대강도 확인 후 분할 접근',
      `${topAffectedSymbols[0] ?? '상위 보유종목'}은 시초가가 약하면 추격 대신 전일 저점·VWAP 회복 여부 확인`,
      'USD/KRW가 추가 상승하면 국내 성장주와 반도체 신규 주문은 한 단계 낮춤',
      'VIX 급등 또는 NQ=F 음전이면 예약 매수 주문을 취소하고 알림만 유지',
    ],
    focusSymbols: Array.from(new Set([...topAffectedSymbols, 'SOX', 'NQ=F', 'USD/KRW', 'VIX'])).slice(0, 8),
  }
}

function portfolioSeverityRank(severity: PortfolioPlaybook['riskSignals'][number]['severity']) {
  if (severity === 'critical') return 4
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

function playbookPriorityRank(priority: PortfolioPlaybook['positionPlans'][number]['priority']) {
  if (priority === 'critical') return 4
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function buildPortfolioPlaybook({
  holdingsData,
  watchlistData,
  indicators,
  biasScoreData,
  forecast,
  newsItems,
  disclosures,
  usdKrw,
}: {
  holdingsData: Holding[]
  watchlistData: WatchItem[]
  indicators: MarketIndicator[]
  biasScoreData: BiasScore
  forecast: MarketForecast
  newsItems: LiveNewsItem[]
  disclosures: DisclosureItem[]
  usdKrw: number
}): PortfolioPlaybook {
  const enrichedHoldings = holdingsData.map((holding) => {
    const profile = getSymbolProfile(holding.symbol, holding.name)
    return {
      ...holding,
      marketValueKrw: holdingMarketValueKrw(holding, usdKrw),
      sector: profile.sector,
      sensitivity: profile.sensitivity,
    }
  })
  const totalValueKrw = enrichedHoldings.reduce((sum, holding) => sum + holding.marketValueKrw, 0)
  const dayPnlKrw = enrichedHoldings.reduce((sum, holding) => sum + holding.marketValueKrw * (holding.dayChange / 100), 0)
  const dayPnlPercent = totalValueKrw > 0 ? round((dayPnlKrw / totalValueKrw) * 100, 2) : 0
  const sortedHoldings = [...enrichedHoldings].sort((a, b) => b.marketValueKrw - a.marketValueKrw)
  const topHolding = sortedHoldings[0]
  const topTwoWeight = sortedHoldings.slice(0, 2).reduce((sum, holding) => sum + holding.portfolioWeight, 0)
  const krWeight = enrichedHoldings.filter((holding) => holding.market === 'KR').reduce((sum, holding) => sum + holding.portfolioWeight, 0)
  const usWeight = enrichedHoldings.filter((holding) => holding.market === 'US').reduce((sum, holding) => sum + holding.portfolioWeight, 0)

  const sectorMap = new Map<string, { value: number; symbols: string[] }>()
  for (const holding of enrichedHoldings) {
    const existing = sectorMap.get(holding.sector) ?? { value: 0, symbols: [] }
    existing.value += holding.marketValueKrw
    existing.symbols.push(holding.symbol)
    sectorMap.set(holding.sector, existing)
  }
  const sectorExposures = Array.from(sectorMap.entries())
    .map(([sector, data]) => ({
      id: `sector-${sector}`,
      label: sector,
      value: data.value,
      percent: totalValueKrw > 0 ? round((data.value / totalValueKrw) * 100, 1) : 0,
      symbols: data.symbols,
    }))
    .sort((a, b) => b.percent - a.percent)
  const topSector = sectorExposures[0]
  const soxPressure = indicatorPressure(indicators, 'SOX')
  const nqPressure = indicatorPressure(indicators, 'NQ=F')
  const usdKrwPressure = indicatorPressure(indicators, 'USD/KRW')
  const vixPressure = indicatorPressure(indicators, 'VIX')
  const concentrationScore = clamp(Math.round((topHolding?.portfolioWeight ?? 0) * 1.2 + Math.max(0, topTwoWeight - 55) * 1.4 + Math.max(0, (topSector?.percent ?? 0) - 45) * 1.2), 0, 100)
  const riskSignals: PortfolioPlaybook['riskSignals'] = []

  if ((topHolding?.portfolioWeight ?? 0) >= 35 || topTwoWeight >= 62) {
    riskSignals.push({
      id: 'concentration',
      title: '상위 종목 쏠림',
      severity: (topHolding?.portfolioWeight ?? 0) >= 42 || topTwoWeight >= 70 ? 'high' : 'medium',
      summary: `${topHolding?.name ?? '상위 종목'} 비중이 ${topHolding?.portfolioWeight ?? 0}%이고 상위 2개 비중은 ${round(topTwoWeight, 1)}%입니다.`,
      evidence: `집중도 ${concentrationScore}/100`,
      suggestedAction: '장 초반 갭 방향이 맞아도 한 종목 추가 매수보다 기존 비중의 손익 방어선을 먼저 정합니다.',
      relatedSymbols: sortedHoldings.slice(0, 2).map((holding) => holding.symbol),
    })
  }

  if (topSector && topSector.percent >= 48) {
    riskSignals.push({
      id: `sector-${topSector.label}`,
      title: `${topSector.label} 섹터 집중`,
      severity: topSector.percent >= 60 ? 'high' : 'medium',
      summary: `${topSector.label} 노출이 ${topSector.percent}%입니다.`,
      evidence: `${topSector.symbols.join(', ')}`,
      suggestedAction: topSector.label.includes('반도체')
        ? 'SOX와 엔비디아 뉴스가 꺾이면 반도체 보유종목의 추가 매수는 보류합니다.'
        : '섹터 대표 지표가 약하면 같은 방향 종목을 동시에 늘리지 않습니다.',
      relatedSymbols: topSector.symbols,
    })
  }

  if (krWeight >= 55 && usdKrwPressure < -0.2) {
    riskSignals.push({
      id: 'usdkrw-pressure',
      title: '환율 부담',
      severity: Math.abs(usdKrwPressure) >= 0.8 ? 'high' : 'medium',
      summary: `국내 비중 ${round(krWeight, 1)}% 상태에서 달러/원 흐름이 국내장에 부담입니다.`,
      evidence: `USD/KRW ${formatChange(Math.abs(usdKrwPressure))} 부담`,
      suggestedAction: '개장 직후 외국인 선물과 환율 재상승을 확인하기 전에는 국내 성장주 추격을 늦춥니다.',
      relatedSymbols: ['USD/KRW', ...enrichedHoldings.filter((holding) => holding.market === 'KR').map((holding) => holding.symbol)],
    })
  }

  if ((topSector?.label.includes('반도체') || topSector?.label.includes('AI')) && topSector.percent >= 35 && soxPressure < -0.2) {
    riskSignals.push({
      id: 'sox-pressure',
      title: '반도체 선행지표 둔화',
      severity: Math.abs(soxPressure) >= 1 ? 'high' : 'medium',
      summary: `${topSector.label} 노출이 큰 상태에서 SOX가 부담 방향입니다.`,
      evidence: `SOX ${formatChange(Math.abs(soxPressure))} 부담`,
      suggestedAction: '삼성전자, SK하이닉스, NVDA 중 지수보다 약한 종목은 첫 반등 실패 여부를 먼저 봅니다.',
      relatedSymbols: ['SOX', ...topSector.symbols],
    })
  }

  if (vixPressure < -1.5 || biasScoreData.stance === 'pressure') {
    riskSignals.push({
      id: 'market-defense',
      title: '시장 방어 우선',
      severity: biasScoreData.score <= 35 || vixPressure < -3 ? 'critical' : 'high',
      summary: `${forecast.openingBias} 흐름입니다. 변동성 또는 방향점수가 방어 쪽입니다.`,
      evidence: `방향점수 ${biasScoreData.score}/100`,
      suggestedAction: '첫 30분은 신규 매수보다 손실 확대 종목과 고비중 종목의 대응 기준을 먼저 확인합니다.',
      relatedSymbols: ['VIX', 'NQ=F', 'USD/KRW'],
    })
  }

  const negativeTrackedNews = newsItems.filter(
    (item) =>
      (item.direction === 'negative' || item.direction === 'mixed') &&
      item.relatedSymbols.some((symbol) => enrichedHoldings.some((holding) => holding.symbol === symbol)),
  )
  if (negativeTrackedNews.length > 0) {
    const topNews = negativeTrackedNews[0]
    riskSignals.push({
      id: `news-${topNews.id}`,
      title: `${topNews.keyword} 뉴스 압력`,
      severity: topNews.importance === 'high' ? 'high' : 'medium',
      summary: topNews.title,
      evidence: `${formatNewsTime(topNews.publishedAt)} · ${topNews.source}`,
      suggestedAction: '뉴스 방향을 단정하지 말고 관련 종목이 지수 대비 약한지 먼저 비교합니다.',
      relatedSymbols: topNews.relatedSymbols,
    })
  }

  const negativeDisclosure = disclosures.find((item) => item.direction === 'negative' || item.direction === 'mixed')
  if (negativeDisclosure) {
    riskSignals.push({
      id: `disclosure-risk-${negativeDisclosure.id}`,
      title: `${negativeDisclosure.corpName} 공시 확인`,
      severity: negativeDisclosure.importance === 'high' ? 'high' : 'medium',
      summary: negativeDisclosure.reportName,
      evidence: formatDisclosureDate(negativeDisclosure.submittedAt),
      suggestedAction: '공시 원문에서 수치, 정정 여부, 계약 조건을 확인하고 가격 반응을 기록합니다.',
      relatedSymbols: [negativeDisclosure.symbol],
    })
  }

  if (riskSignals.length === 0) {
    riskSignals.push({
      id: 'stable',
      title: '즉시 방어 신호 낮음',
      severity: 'low',
      summary: '현재 조합에서는 집중도와 선행지표 부담이 과도하지 않습니다.',
      evidence: `집중도 ${concentrationScore}/100`,
      suggestedAction: '그래도 개장 30분 상대강도와 환율 급변은 계속 체크합니다.',
      relatedSymbols: ['NQ=F', 'SOX', 'USD/KRW'],
    })
  }

  const positionPlans: PortfolioPlaybook['positionPlans'] = [
    ...enrichedHoldings.map((holding) => {
      const highWeight = holding.portfolioWeight >= 30
      const weakPrice = holding.dayChange <= -1 || holding.impact === 'negative'
      const favorableMarket = biasScoreData.stance === 'favorable' && nqPressure >= -0.15
      const action: PortfolioPlaybook['positionPlans'][number]['action'] =
        highWeight && (weakPrice || biasScoreData.stance !== 'favorable')
          ? 'trim-watch'
          : weakPrice
            ? 'observe'
            : favorableMarket && holding.impact === 'positive'
              ? 'hold'
              : 'observe'
      const priority: PortfolioPlaybook['positionPlans'][number]['priority'] =
        action === 'trim-watch' && highWeight ? 'high' : action === 'trim-watch' || weakPrice ? 'medium' : 'low'

      return {
        id: `holding-plan-${holding.symbol}`,
        symbol: holding.symbol,
        name: holding.name,
        action,
        priority,
        reason: `${holding.portfolioWeight}% 비중, 당일 ${formatChange(holding.dayChange)}, ${holding.sector} 노출`,
        trigger:
          action === 'trim-watch'
            ? '시초가 반등 실패 또는 지수 대비 약세면 비중 확대 금지'
            : action === 'hold'
              ? '지수보다 강하고 거래량이 붙으면 보유 유지'
              : '첫 30분 상대강도 확인 후 판단',
        priceGuide: `현재 ${formatCurrency(holding.currentPrice, holding.market)} / 평단 ${formatCurrency(holding.averagePrice, holding.market)}`,
      }
    }),
    ...watchlistData
      .filter((item) => item.status !== 'waiting' || item.distanceToBuy <= 6)
      .map((item) => {
        const marketOk = biasScoreData.score >= 55 && (soxPressure >= -0.2 || !item.trigger.includes('AI'))
        const action: PortfolioPlaybook['positionPlans'][number]['action'] = marketOk && item.status !== 'alert' ? 'add-ready' : 'avoid'
        const priority: PortfolioPlaybook['positionPlans'][number]['priority'] = item.status === 'near' ? 'medium' : 'low'
        return {
          id: `watch-plan-${item.symbol}`,
          symbol: item.symbol,
          name: item.name,
          action,
          priority,
          reason: `관심가까지 ${item.distanceToBuy.toFixed(1)}%`,
          trigger: marketOk ? '관심가 근처에서 지수와 뉴스 방향이 같이 맞을 때만 분할' : '시장 조건이 맞기 전에는 진입 보류',
          priceGuide: `현재 ${formatCurrency(item.currentPrice, item.symbol.length === 6 ? 'KR' : 'US')} / 관심가 ${formatCurrency(item.targetBuyPrice, item.symbol.length === 6 ? 'KR' : 'US')}`,
        }
      }),
  ]
    .sort((a, b) => playbookPriorityRank(b.priority) - playbookPriorityRank(a.priority))
    .slice(0, 7)

  const stance: PortfolioPlaybook['stance'] =
    riskSignals.some((item) => item.severity === 'critical' || item.severity === 'high') || biasScoreData.score < 45
      ? 'defensive'
      : biasScoreData.score >= 60 && dayPnlPercent >= -0.5
        ? 'risk-on'
        : 'balanced'
  const stanceLabel = stance === 'risk-on' ? '선별 공격' : stance === 'defensive' ? '방어 우선' : '균형 유지'
  const exposures: PortfolioPlaybook['exposures'] = [
    {
      id: 'market-kr',
      label: '국내 주식',
      value: totalValueKrw * (krWeight / 100),
      percent: round(krWeight, 1),
      tone: krWeight >= 65 && usdKrwPressure < -0.2 ? 'warning' : 'neutral',
      symbols: enrichedHoldings.filter((holding) => holding.market === 'KR').map((holding) => holding.symbol),
      note: usdKrwPressure < -0.2 ? '환율 부담이 국내 비중에 직접 반영됩니다.' : '국내장 방향점수와 외국인 수급을 같이 봅니다.',
    },
    {
      id: 'market-us',
      label: '미국 주식',
      value: totalValueKrw * (usWeight / 100),
      percent: round(usWeight, 1),
      tone: usWeight >= 35 && nqPressure < -0.2 ? 'warning' : 'neutral',
      symbols: enrichedHoldings.filter((holding) => holding.market === 'US').map((holding) => holding.symbol),
      note: nqPressure < -0.2 ? '나스닥 선물 약세가 미국 성장주에 부담입니다.' : 'NQ=F와 달러 흐름을 같이 봅니다.',
    },
    ...sectorExposures.slice(0, 4).map((exposure) => {
      const tone: PortfolioPlaybook['exposures'][number]['tone'] =
        exposure.percent >= 55
          ? 'warning'
          : exposure.label.includes('반도체') && soxPressure > 0.2
            ? 'positive'
            : exposure.label.includes('반도체') && soxPressure < -0.2
              ? 'negative'
              : 'neutral'
      return {
        ...exposure,
        tone,
        note:
        exposure.label.includes('반도체') || exposure.label.includes('AI')
          ? 'SOX, NVDA, AI 뉴스와 민감하게 움직입니다.'
          : '섹터 뉴스와 해당 종목 상대강도를 확인합니다.',
      }
    }),
  ]

  return {
    totalValueKrw,
    dayPnlKrw,
    dayPnlPercent,
    stance,
    stanceLabel,
    summary:
      stance === 'defensive'
        ? '오늘은 신규 진입보다 고비중 종목과 리스크 신호를 먼저 정리하는 쪽이 유리합니다.'
        : stance === 'risk-on'
          ? '선행지표가 받쳐주면 강한 보유종목은 유지하고 관심종목은 분할 조건만 확인합니다.'
          : '방향이 과하게 한쪽으로 쏠리지 않았으므로 첫 30분 가격 반응을 본 뒤 움직입니다.',
    concentrationScore,
    topExposureLabel: topSector ? `${topSector.label} ${topSector.percent}%` : '노출 계산 대기',
    exposures,
    riskSignals: riskSignals.sort((a, b) => portfolioSeverityRank(b.severity) - portfolioSeverityRank(a.severity)).slice(0, 5),
    positionPlans,
    preMarketSteps: [
      `${forecast.openingBias} 기준으로 첫 30분 추격 매수 금지/허용 기준을 정합니다.`,
      topSector ? `${topSector.label} 대표 종목이 지수보다 강한지 먼저 확인합니다.` : '보유종목 상대강도를 먼저 확인합니다.',
      riskSignals[0] ? `${riskSignals[0].title} 신호가 완화되는지 체크합니다.` : '환율, VIX, NQ=F 급변 여부를 체크합니다.',
      watchlistData.some((item) => item.status === 'near') ? '관심가 근접 종목은 뉴스와 거래량이 같이 맞을 때만 분할합니다.' : '관심종목은 지수 방향 확인 전까지 대기합니다.',
    ],
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

function briefDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return getKstDateKey()

  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function uniqueBriefItems(items: Array<string | null | undefined>, maxItems: number) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))).slice(0, maxItems)
}

function buildMorningBrief({
  forecast,
  portfolioPlaybook,
  actionQueue,
  triggeredAlerts,
  newsItems,
  eventsData,
  disclosures,
  marketStatusData,
  dataReliability,
  executionPlan,
}: {
  forecast: MarketForecast
  portfolioPlaybook: PortfolioPlaybook
  actionQueue: ActionQueueItem[]
  triggeredAlerts: TriggeredAlert[]
  newsItems: LiveNewsItem[]
  eventsData: CalendarEvent[]
  disclosures: DisclosureItem[]
  marketStatusData: MarketStatusView
  dataReliability: DataReliability
  executionPlan: ExecutionPlan
}): MorningBrief {
  const generatedAt = new Date().toISOString()
  const topAction = actionQueue[0]
  const topExecution = executionPlan.items[0]
  const topRisk = portfolioPlaybook.riskSignals[0]
  const topScenario = forecast.scenarios.reduce((top, scenario) => (scenario.probability > top.probability ? scenario : top), forecast.scenarios[0])
  const urgentAlerts = triggeredAlerts.filter((alert) => severityRank(alert.severity) >= severityRank('high'))
  const topNews = newsItems.filter((item) => item.importance === 'high').slice(0, 2)
  const todayEvents = eventsData.filter((event) => isTodayCalendarEvent(event)).slice(0, 2)
  const importantDisclosures = disclosures.filter((item) => item.importance === 'high').slice(0, 2)
  const topSymbols = uniqueBriefItems(
    [
      ...portfolioPlaybook.positionPlans.slice(0, 3).map((item) => item.symbol),
      ...actionQueue.flatMap((item) => item.relatedSymbols).slice(0, 5),
      ...urgentAlerts.flatMap((item) => item.relatedSymbols),
    ],
    6,
  )
  const headline =
    portfolioPlaybook.stance === 'defensive'
      ? `${forecast.openingBias}: 신규 진입보다 방어와 고비중 종목 확인이 먼저입니다.`
      : portfolioPlaybook.stance === 'risk-on'
        ? `${forecast.openingBias}: 강한 종목만 선별하고 관심종목은 분할 조건으로 봅니다.`
        : `${forecast.openingBias}: 첫 30분 가격 반응을 확인한 뒤 움직이는 구간입니다.`

  const sections: MorningBrief['sections'] = [
    {
      id: 'market',
      title: '시장 방향',
      items: uniqueBriefItems(
        [
          `방향점수 ${forecast.baseScore}/100, 예상 출발 ${forecast.expectedOpenRange}`,
          `가장 가능성 높은 시나리오: ${topScenario.label} ${topScenario.probability}%`,
          `데이터 신뢰도 ${dataReliability.score}/100 (${dataReliability.label})`,
          `USD/KRW ${marketStatusData.usdKrw}, VIX ${marketStatusData.vix}`,
          forecast.summary,
        ],
        4,
      ),
    },
    {
      id: 'portfolio',
      title: '포트폴리오 판단',
      items: uniqueBriefItems(
        [
          `${portfolioPlaybook.stanceLabel}: ${portfolioPlaybook.summary}`,
          `최대 노출 ${portfolioPlaybook.topExposureLabel}, 집중도 ${portfolioPlaybook.concentrationScore}/100`,
          topRisk ? `${topRisk.title}: ${topRisk.suggestedAction}` : null,
          ...portfolioPlaybook.positionPlans.slice(0, 3).map((item) => `${item.symbol} ${positionActionLabel[item.action]}: ${item.trigger}`),
        ],
        5,
      ),
    },
    {
      id: 'issues',
      title: '오늘 이슈',
      items: uniqueBriefItems(
        [
          ...topNews.map((item) => `${item.keyword}: ${item.title}`),
          ...importantDisclosures.map((item) => `${item.corpName} 공시: ${item.reportName}`),
          ...todayEvents.map((event) => `${event.time} ${event.title}`),
          urgentAlerts.length > 0 ? `긴급/높음 알림 ${urgentAlerts.length}개 발동` : null,
        ],
        5,
      ),
    },
    {
      id: 'actions',
      title: '먼저 할 일',
      items: uniqueBriefItems(
        [
          topAction ? `${topAction.title}: ${topAction.suggestedAction}` : null,
          topExecution ? `${topExecution.symbol} ${executionSideLabel(topExecution.side)}: ${topExecution.quantityGuide}, ${topExecution.priceBand}` : null,
          ...portfolioPlaybook.preMarketSteps.slice(0, 3),
          ...forecast.checklist.slice(0, 2),
        ],
        6,
      ),
    },
  ]

  const copyLines = [
    `[Tracking Money 장전 브리핑 · ${briefDateLabel(generatedAt)}]`,
    headline,
    '',
    ...sections.flatMap((section) => [`[${section.title}]`, ...section.items.map((item) => `- ${item}`), '']),
    topSymbols.length > 0 ? `관련 종목: ${topSymbols.join(', ')}` : '',
  ].filter((line, index, lines) => line || lines[index - 1] !== '')

  return {
    generatedAt,
    title: '장전 브리핑',
    headline,
    stance: portfolioPlaybook.stance,
    confidence: forecast.confidence,
    keyMetric: `${forecast.openingBias} · ${forecast.expectedOpenRange}`,
    topSymbols,
    sections,
    copyText: copyLines.join('\n').trim(),
  }
}

function buildPreMarketCommandCenter({
  forecast,
  forecastSensitivity,
  koreaMarketBridge,
  newsImpactBoard,
  portfolioPlaybook,
  actionQueue,
  executionPlan,
  dataReliability,
  marketStatusData,
}: {
  forecast: MarketForecast
  forecastSensitivity: ForecastSensitivity
  koreaMarketBridge: KoreaMarketBridge
  newsImpactBoard: NewsImpactBoard
  portfolioPlaybook: PortfolioPlaybook
  actionQueue: ActionQueueItem[]
  executionPlan: ExecutionPlan
  dataReliability: DataReliability
  marketStatusData: MarketStatusView
}): PreMarketCommandCenter {
  const mode: PreMarketCommandCenter['mode'] =
    forecast.baseScore >= 62 && koreaMarketBridge.riskLevel === 'low'
      ? 'risk-on'
      : forecast.baseScore <= 43 || portfolioPlaybook.stance === 'defensive' || koreaMarketBridge.riskLevel === 'high'
        ? 'defensive'
        : 'balanced'
  const gateTone: PreMarketCommandCenter['gateTone'] = mode === 'risk-on' ? 'positive' : mode === 'defensive' ? 'negative' : 'warning'
  const modeLabel = mode === 'risk-on' ? '선별 공격' : mode === 'defensive' ? '방어 우선' : '확인 후 진입'
  const topAction = actionQueue[0]
  const topExecution = executionPlan.items[0]
  const topNews = newsImpactBoard.items[0]
  const topBridgeRisk = koreaMarketBridge.signals.find((signal) => signal.impact < 0) ?? koreaMarketBridge.signals[0]
  const primaryDecision =
    mode === 'risk-on'
      ? '첫 30분 상대강도가 확인된 종목만 분할 접근'
      : mode === 'defensive'
        ? '신규 매수보다 고비중 종목 리스크와 환율·선물 확인 우선'
        : '시초가 추격 금지, 선행지표와 대장주 반응을 확인한 뒤 판단'
  const metrics: PreMarketCommandCenter['metrics'] = [
    {
      label: '방향점수',
      value: `${forecast.baseScore}/100`,
      detail: forecast.openingBias,
      tone: forecast.baseScore >= 62 ? 'positive' : forecast.baseScore <= 43 ? 'negative' : 'warning',
    },
    {
      label: '브리지',
      value: `${koreaMarketBridge.score}/100`,
      detail: koreaMarketBridge.label,
      tone: koreaMarketBridge.tone,
    },
    {
      label: '민감도',
      value: forecastSensitivity.upsideGap === 0 ? '상방권' : `+${forecastSensitivity.upsideGap}`,
      detail: forecastSensitivity.downsideGap === 0 ? '방어 전환' : `방어까지 -${forecastSensitivity.downsideGap}`,
      tone: forecastSensitivity.downsideGap === 0 ? 'negative' : forecastSensitivity.upsideGap === 0 ? 'positive' : 'warning',
    },
    {
      label: '데이터',
      value: `${dataReliability.score}/100`,
      detail: dataReliability.label,
      tone: dataReliability.tone,
    },
  ]
  const steps: PreMarketCommandCenter['steps'] = [
    {
      id: 'market-temperature',
      order: 1,
      timeLabel: '08:45',
      title: '미국 선물·환율 온도 확인',
      priority: koreaMarketBridge.riskLevel === 'high' ? 'critical' : 'high',
      tone: koreaMarketBridge.tone,
      trigger: `${forecastSensitivity.topUpsideFactor} 개선 / ${forecastSensitivity.topDownsideFactor} 악화 여부`,
      action: koreaMarketBridge.openBias,
      evidence: `${marketStatusData.usdKrw} · VIX ${marketStatusData.vix}`,
      relatedSymbols: ['NQ=F', 'SOX', 'USD/KRW', 'VIX'],
    },
    {
      id: 'leader-check',
      order: 2,
      timeLabel: '09:00',
      title: '대장주 상대강도 확인',
      priority: topNews && Math.abs(topNews.score) >= 45 ? 'high' : 'medium',
      tone: topNews?.tone ?? 'neutral',
      trigger: topNews ? `${topNews.symbol} 뉴스 점수 ${topNews.score > 0 ? '+' : ''}${topNews.score}` : '뉴스 영향 종목 확인',
      action: topNews?.suggestedAction ?? '삼성전자, SK하이닉스, NAVER, 관심종목의 지수 대비 강도를 확인합니다.',
      evidence: topNews ? topNews.topHeadline : newsImpactBoard.summary,
      relatedSymbols: topNews ? [topNews.symbol, ...topNews.catalysts].slice(0, 6) : newsImpactBoard.hotSymbols,
    },
    {
      id: 'risk-gate',
      order: 3,
      timeLabel: '09:15',
      title: '매수/방어 게이트 결정',
      priority: mode === 'defensive' ? 'critical' : mode === 'risk-on' ? 'medium' : 'high',
      tone: gateTone,
      trigger: primaryDecision,
      action: topAction?.suggestedAction ?? primaryDecision,
      evidence: topAction?.evidence ?? forecast.summary,
      relatedSymbols: topAction?.relatedSymbols.slice(0, 6) ?? forecastSensitivity.factors.slice(0, 4).map((factor) => factor.symbol),
    },
    {
      id: 'execution-filter',
      order: 4,
      timeLabel: '09:30',
      title: '실행 후보 필터링',
      priority: topExecution?.priority ?? 'medium',
      tone: topExecution?.side === 'buy' ? 'positive' : topExecution?.side === 'sell' ? 'warning' : 'neutral',
      trigger: topExecution ? `${topExecution.symbol} ${executionSideLabel(topExecution.side)} 조건` : '실행 후보 확인',
      action: topExecution ? `${topExecution.quantityGuide}, ${topExecution.priceBand}` : '실행 후보가 없으면 관찰만 유지합니다.',
      evidence: topExecution?.reason ?? executionPlan.summary,
      relatedSymbols: topExecution ? [topExecution.symbol, ...topExecution.relatedSignals].slice(0, 6) : executionPlan.items.slice(0, 4).map((item) => item.symbol),
    },
  ]
  const goConditions = uniqueBriefItems(
    [
      mode === 'risk-on' ? '방향점수와 브리지가 모두 상방권 유지' : null,
      `상방 전환: ${forecastSensitivity.transitionChecklist[0]?.replace('상방 전환: ', '') ?? 'NQ/SOX 유지와 환율 안정'}`,
      topNews && topNews.score > 0 ? `${topNews.symbol} 우호 뉴스에 거래량 동반` : null,
      topExecution ? `${topExecution.symbol} ${topExecution.trigger}` : null,
    ],
    4,
  )
  const stopConditions = uniqueBriefItems(
    [
      mode === 'defensive' ? '이미 방어 모드: 신규 진입은 첫 반등 확인 전까지 보류' : null,
      `하방 전환: ${forecastSensitivity.transitionChecklist[1]?.replace('하방 전환: ', '') ?? '환율, VIX, 금리 급등'}`,
      topBridgeRisk ? `${topBridgeRisk.symbol} 부담 확대` : null,
      portfolioPlaybook.riskSignals[0] ? portfolioPlaybook.riskSignals[0].suggestedAction : null,
    ],
    4,
  )
  const focusSymbols = uniqueBriefItems(
    [...steps.flatMap((step) => step.relatedSymbols), ...koreaMarketBridge.watchSymbols, ...newsImpactBoard.hotSymbols],
    10,
  )
  const summary = `${modeLabel}: ${primaryDecision}. 핵심은 ${forecastSensitivity.topUpsideFactor}/${forecastSensitivity.topDownsideFactor} 전환과 ${topNews?.symbol ?? '뉴스 영향 종목'} 반응입니다.`
  const copyText = [
    `[장전 운전석] ${modeLabel}`,
    summary,
    '',
    '[순서]',
    ...steps.map((step) => `${step.order}. ${step.timeLabel} ${step.title} - ${step.action}`),
    '',
    '[진입 조건]',
    ...goConditions.map((item) => `- ${item}`),
    '',
    '[보류/방어 조건]',
    ...stopConditions.map((item) => `- ${item}`),
  ].join('\n')

  return {
    generatedAt: new Date().toISOString(),
    mode,
    modeLabel,
    gateLabel: primaryDecision,
    gateTone,
    summary,
    primaryDecision,
    metrics,
    steps,
    goConditions,
    stopConditions,
    focusSymbols,
    copyText,
  }
}

function alertSeverityFromDistance(distance: number): TriggeredAlert['severity'] {
  if (distance >= 8) return 'critical'
  if (distance >= 4) return 'high'
  if (distance >= 1.5) return 'medium'
  return 'low'
}

function findPriceAlertTarget(rule: AlertRule, holdingsData: Holding[], watchlistData: WatchItem[]) {
  const normalizedTarget = rule.target.toUpperCase()
  const holding = holdingsData.find(
    (item) => item.symbol.toUpperCase() === normalizedTarget || item.name.toLocaleLowerCase('ko-KR') === rule.target.toLocaleLowerCase('ko-KR'),
  )
  if (holding) {
    return {
      symbol: holding.symbol,
      name: holding.name,
      market: holding.market,
      price: holding.currentPrice,
      change: holding.dayChange,
    }
  }

  const watchItem = watchlistData.find(
    (item) => item.symbol.toUpperCase() === normalizedTarget || item.name.toLocaleLowerCase('ko-KR') === rule.target.toLocaleLowerCase('ko-KR'),
  )
  if (!watchItem) return null

  return {
    symbol: watchItem.symbol,
    name: watchItem.name,
    market: defaultMarketForSymbol(watchItem.symbol),
    price: watchItem.currentPrice,
    change: null,
  }
}

function findChangeAlertTarget(rule: AlertRule, holdingsData: Holding[], indicators: MarketIndicator[]) {
  const normalizedTarget = rule.target.toUpperCase()
  const indicator = indicators.find(
    (item) => item.symbol.toUpperCase() === normalizedTarget || item.name.toLocaleLowerCase('ko-KR') === rule.target.toLocaleLowerCase('ko-KR'),
  )
  if (indicator) {
    return {
      symbol: indicator.symbol,
      name: indicator.name,
      change: indicator.change,
      evidence: `${indicator.symbol} ${formatChange(indicator.change)}`,
    }
  }

  const holding = holdingsData.find(
    (item) => item.symbol.toUpperCase() === normalizedTarget || item.name.toLocaleLowerCase('ko-KR') === rule.target.toLocaleLowerCase('ko-KR'),
  )
  if (!holding) return null

  return {
    symbol: holding.symbol,
    name: holding.name,
    change: holding.dayChange,
    evidence: `${holding.name} ${formatChange(holding.dayChange)}`,
  }
}

function buildTriggeredAlerts({
  alertRulesData,
  holdingsData,
  watchlistData,
  indicators,
  newsItems,
  biasScoreData,
}: {
  alertRulesData: AlertRule[]
  holdingsData: Holding[]
  watchlistData: WatchItem[]
  indicators: MarketIndicator[]
  newsItems: LiveNewsItem[]
  biasScoreData: BiasScore
}): TriggeredAlert[] {
  return alertRulesData
    .filter((rule) => rule.enabled)
    .flatMap((rule): TriggeredAlert[] => {
      if (rule.type === 'price-above' || rule.type === 'price-below') {
        const target = findPriceAlertTarget(rule, holdingsData, watchlistData)
        if (!target) return []

        const triggered = rule.type === 'price-above' ? target.price >= rule.threshold : target.price <= rule.threshold
        if (!triggered) return []

        const distance = rule.threshold > 0 ? Math.abs(((target.price - rule.threshold) / rule.threshold) * 100) : 0
        return [
          {
            id: `alert-${rule.id}`,
            ruleId: rule.id,
            title: rule.name,
            summary: `${target.name}이 ${alertRuleTypeLabel[rule.type]} 조건에 도달했습니다.`,
            severity: alertSeverityFromDistance(distance),
            evidence: `현재 ${formatCurrency(target.price, target.market)} / 기준 ${formatCurrency(rule.threshold, target.market)}`,
            relatedSymbols: [target.symbol],
          },
        ]
      }

      if (rule.type === 'change-above' || rule.type === 'change-below') {
        const target = findChangeAlertTarget(rule, holdingsData, indicators)
        if (!target) return []

        const triggered = rule.type === 'change-above' ? target.change >= rule.threshold : target.change <= rule.threshold
        if (!triggered) return []

        const distance = Math.abs(target.change - rule.threshold)
        return [
          {
            id: `alert-${rule.id}`,
            ruleId: rule.id,
            title: rule.name,
            summary: `${target.name} 등락률 조건이 발동했습니다.`,
            severity: alertSeverityFromDistance(distance),
            evidence: `${target.evidence} / 기준 ${formatChange(rule.threshold)}`,
            relatedSymbols: [target.symbol],
          },
        ]
      }

      if (rule.type === 'news-keyword') {
        const keyword = rule.target.toLocaleLowerCase('ko-KR')
        const matchedNews = newsItems.find((item) =>
          [item.keyword, item.title, item.description, ...item.relatedSymbols, ...item.sectors]
            .join(' ')
            .toLocaleLowerCase('ko-KR')
            .includes(keyword),
        )
        if (!matchedNews) return []

        return [
          {
            id: `alert-${rule.id}`,
            ruleId: rule.id,
            title: rule.name,
            summary: `${rule.target} 관련 뉴스가 수집됐습니다.`,
            severity: matchedNews.importance === 'high' ? 'high' : 'medium',
            evidence: matchedNews.title,
            relatedSymbols: matchedNews.relatedSymbols.length > 0 ? matchedNews.relatedSymbols : [rule.target],
          },
        ]
      }

      if (rule.type === 'bias-above' || rule.type === 'bias-below') {
        const triggered = rule.type === 'bias-above' ? biasScoreData.score >= rule.threshold : biasScoreData.score <= rule.threshold
        if (!triggered) return []

        return [
          {
            id: `alert-${rule.id}`,
            ruleId: rule.id,
            title: rule.name,
            summary: `내일 국내장 방향점수가 조건에 도달했습니다.`,
            severity: rule.type === 'bias-below' ? 'high' : 'medium',
            evidence: `현재 ${biasScoreData.score}/100 / 기준 ${rule.threshold}/100`,
            relatedSymbols: [biasScoreData.market],
          },
        ]
      }

      return []
    })
    .sort((a, b) => priorityRank(b.severity) - priorityRank(a.severity))
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

function reliabilityTone(score: number): DataReliability['tone'] {
  if (score >= 82) return 'positive'
  if (score >= 45) return 'warning'
  return 'negative'
}

function reliabilityLabel(score: number) {
  if (score >= 82) return '실데이터 우세'
  if (score >= 64) return '부분 실데이터'
  if (score >= 45) return '대체 데이터 혼합'
  return '연결 점검 필요'
}

function reliabilityConfidence(score: number): DataReliability['confidence'] {
  if (score >= 78) return 'high'
  if (score >= 52) return 'medium'
  return 'low'
}

function statusReliabilityScore(status: DataHealthStatus) {
  if (status === 'ready' || status === 'local') return 90
  if (status === 'partial') return 68
  if (status === 'loading') return 46
  if (status === 'fallback' || status === 'planned') return 34
  if (status === 'idle') return 20
  return 10
}

function buildDataReliability({
  quoteStatus,
  quoteMessage,
  liveQuoteCount,
  expectedQuoteCount,
  newsStatus,
  newsMessage,
  liveNewsCount,
  calendarStatus,
  calendarMessage,
  calendarEventCount,
  disclosureStatus,
  disclosureMessage,
  disclosureCount,
}: {
  quoteStatus: QuoteStatus
  quoteMessage: string
  liveQuoteCount: number
  expectedQuoteCount: number
  newsStatus: NewsStatus
  newsMessage: string
  liveNewsCount: number
  calendarStatus: CalendarStatus
  calendarMessage: string
  calendarEventCount: number
  disclosureStatus: DisclosureStatus
  disclosureMessage: string
  disclosureCount: number
}): DataReliability {
  const quoteCoverage = expectedQuoteCount > 0 ? clamp(liveQuoteCount / expectedQuoteCount, 0, 1) : liveQuoteCount > 0 ? 1 : 0
  const quoteScore =
    quoteStatus === 'ready' || quoteStatus === 'partial'
      ? clamp(statusReliabilityScore(quoteStatus) + Math.round(quoteCoverage * 10), 0, 100)
      : statusReliabilityScore(quoteStatus)
  const newsScore = newsStatus === 'ready' ? clamp(statusReliabilityScore(newsStatus) + Math.min(8, liveNewsCount), 0, 100) : statusReliabilityScore(newsStatus)
  const calendarScore =
    calendarStatus === 'ready' ? clamp(statusReliabilityScore(calendarStatus) + Math.min(6, Math.round(calendarEventCount / 2)), 0, 100) : statusReliabilityScore(calendarStatus)
  const disclosureScore =
    disclosureStatus === 'ready' || disclosureStatus === 'partial'
      ? clamp(statusReliabilityScore(disclosureStatus) + Math.min(6, disclosureCount), 0, 100)
      : statusReliabilityScore(disclosureStatus)
  const sources: DataReliability['sources'] = [
    {
      id: 'quotes',
      name: '시세·선행지표',
      statusLabel: dataHealthStatusLabel[quoteStatus],
      modeLabel: dataModeLabel(quoteStatus),
      tone: dataHealthVariant(quoteStatus),
      score: quoteScore,
      weight: 40,
      metric: `${liveQuoteCount}/${expectedQuoteCount || liveQuoteCount || 0}개`,
      endpoint: '/api/quotes -> Yahoo Finance chart',
      requiredConfig: '별도 API 키 없음',
      summary: quoteMessage,
      effect: '방향점수, 보유/관심 가격, 환율·VIX·SOX 해석에 직접 반영됩니다.',
      nextAction:
        quoteStatus === 'ready' || quoteStatus === 'partial'
          ? '장 시작 직전 전체 새로고침으로 NQ=F, SOX, USD/KRW 최신값만 다시 확인'
          : '시세 새로고침 후 NQ=F, SOX, USD/KRW가 들어오는지 확인',
    },
    {
      id: 'news',
      name: '뉴스 이슈',
      statusLabel: dataHealthStatusLabel[newsStatus],
      modeLabel: dataModeLabel(newsStatus),
      tone: dataHealthVariant(newsStatus),
      score: newsScore,
      weight: 25,
      metric: `${liveNewsCount}건`,
      endpoint: '/api/news -> Naver News Open API',
      requiredConfig: 'NAVER_CLIENT_ID, NAVER_CLIENT_SECRET',
      summary: newsMessage,
      effect: '종목별 이슈, 방향점수 보정, 액션 큐와 장전 브리핑에 반영됩니다.',
      nextAction:
        newsStatus === 'ready'
          ? '키워드가 내 보유/관심종목을 충분히 덮는지 확인하고 필요하면 설정에서 추가'
          : 'Vercel 환경변수 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET과 키워드 목록 확인',
    },
    {
      id: 'disclosures',
      name: 'DART 공시',
      statusLabel: dataHealthStatusLabel[disclosureStatus],
      modeLabel: dataModeLabel(disclosureStatus),
      tone: dataHealthVariant(disclosureStatus),
      score: disclosureScore,
      weight: 20,
      metric: `${disclosureCount}건`,
      endpoint: '/api/disclosures -> OpenDART',
      requiredConfig: 'OPENDART_API_KEY',
      summary: disclosureMessage,
      effect: '국내 보유/관심종목의 실적·주요사항 원문 리스크를 보정합니다.',
      nextAction:
        disclosureStatus === 'ready' || disclosureStatus === 'partial'
          ? '공시 제목만 보지 말고 큰 점수 항목은 원문 링크에서 제출 사유 확인'
          : 'Vercel 환경변수 OPENDART_API_KEY 또는 최근 국내 공시 유무 확인',
    },
    {
      id: 'calendar',
      name: '일정 캘린더',
      statusLabel: dataHealthStatusLabel[calendarStatus],
      modeLabel: dataModeLabel(calendarStatus),
      tone: dataHealthVariant(calendarStatus),
      score: calendarScore,
      weight: 15,
      metric: `${calendarEventCount}개`,
      endpoint: '/api/calendar -> Tracking Money event rules',
      requiredConfig: '별도 API 키 없음',
      summary: calendarMessage,
      effect: 'CPI, FOMC, 실적 구간처럼 이벤트 전후 변동성 판단에 반영됩니다.',
      nextAction:
        calendarStatus === 'ready'
          ? 'estimated 일정은 실제 발표 시간 전 공식 캘린더나 IR에서 재확인'
          : '캘린더 새로고침 후 오늘/이번 주 이벤트 확인',
    },
  ]
  const totalWeight = sources.reduce((sum, source) => sum + source.weight, 0)
  const score = Math.round(sources.reduce((sum, source) => sum + source.score * source.weight, 0) / totalWeight)
  const connectedCount = sources.filter((source) => source.score >= 64).length
  const nextActions = [
    quoteStatus === 'ready' || quoteStatus === 'partial' ? null : '시세 새로고침 후 NQ=F, SOX, USD/KRW가 들어오는지 확인',
    newsStatus === 'ready' ? null : '네이버 뉴스 환경변수와 키워드 목록 확인',
    disclosureStatus === 'ready' || disclosureStatus === 'partial' ? null : 'OpenDART 키 또는 최근 국내 공시 유무 확인',
    calendarStatus === 'ready' ? null : '캘린더 새로고침 후 오늘/이번 주 이벤트 확인',
  ].filter((item): item is string => item !== null)

  return {
    score,
    label: reliabilityLabel(score),
    tone: reliabilityTone(score),
    confidence: reliabilityConfidence(score),
    summary:
      score >= 82
        ? `핵심 데이터 ${connectedCount}/${sources.length}개가 충분히 연결되어 예측과 브리핑을 적극 참고할 수 있습니다.`
        : score >= 64
          ? `핵심 데이터 ${connectedCount}/${sources.length}개가 연결되어 있지만 일부 소스는 대체 데이터가 섞여 있습니다.`
          : score >= 45
            ? `실데이터와 대체 데이터가 섞여 있으니 방향성은 참고하되 개장 전 원자료를 한 번 더 확인해야 합니다.`
            : `실데이터 연결이 약해 현재 예측은 체크리스트 수준으로만 보는 편이 좋습니다.`,
    sources,
    nextActions: nextActions.length > 0 ? nextActions.slice(0, 4) : ['현재 연결 상태는 양호합니다. 개장 직전 시세 새로고침만 한 번 더 확인하면 됩니다.'],
  }
}

function buildDataFreshness({
  dataReliability,
  quoteFetchedAt,
  newsFetchedAt,
  calendarFetchedAt,
  disclosureFetchedAt,
}: {
  dataReliability: DataReliability
  quoteFetchedAt: string | null
  newsFetchedAt: string | null
  calendarFetchedAt: string | null
  disclosureFetchedAt: string | null
}): DataFreshness {
  const now = Date.now()
  const timestampBySource: Record<DataFreshnessSource['id'], string | null> = {
    quotes: quoteFetchedAt,
    news: newsFetchedAt,
    calendar: calendarFetchedAt,
    disclosures: disclosureFetchedAt,
  }
  const staleAfterBySource: Record<DataFreshnessSource['id'], number> = {
    quotes: 5,
    news: 15,
    disclosures: 30,
    calendar: 90,
  }
  const cadenceBySource: Record<DataFreshnessSource['id'], string> = {
    quotes: '화면 120초 갱신 / 5분 초과 경고',
    news: '화면 10분 갱신 / 15분 초과 경고',
    disclosures: '화면 15분 갱신 / 30분 초과 경고',
    calendar: '화면 1시간 갱신 / 90분 초과 경고',
  }
  const sources = dataReliability.sources.map((source) => {
    const updatedAt = timestampBySource[source.id]
    const staleAfterMinutes = staleAfterBySource[source.id]
    const ageMinutes = minutesSince(updatedAt, now)
    const statusLabel = freshnessStatusLabel(ageMinutes, staleAfterMinutes)
    const tone = freshnessTone(ageMinutes, staleAfterMinutes, source.tone)
    const ageLabel = freshnessAgeLabel(ageMinutes)
    const summary =
      ageMinutes === null
        ? `${source.name}은 아직 이번 세션에서 수신 시간이 확인되지 않았습니다.`
        : `${source.name}은 ${ageLabel} 수신된 ${source.modeLabel}입니다.`

    return {
      id: source.id,
      name: source.name,
      modeLabel: source.modeLabel,
      tone,
      statusLabel,
      updatedAt,
      updatedLabel: updatedAt ? formatNewsTime(updatedAt) : '수신 전',
      ageMinutes,
      ageLabel,
      staleAfterMinutes,
      cadenceLabel: cadenceBySource[source.id],
      summary,
      nextAction: tone === 'negative' || tone === 'warning' ? source.nextAction : `${source.name}은 현재 최신성 기준 안에 있습니다.`,
    }
  })
  const freshnessPoints: number[] = sources.map((source) => {
    if (source.ageMinutes === null) return 0
    if (source.ageMinutes <= source.staleAfterMinutes) return 100
    if (source.ageMinutes <= source.staleAfterMinutes * 2) return 62
    return 24
  })
  const score = Math.round(freshnessPoints.reduce((sum, point) => sum + point, 0) / Math.max(1, freshnessPoints.length))
  const staleCount = sources.filter((source) => source.statusLabel === '갱신 필요' || source.statusLabel === '오래됨').length
  const missingCount = sources.filter((source) => source.ageMinutes === null).length
  const nextSource = sources
    .filter((source) => source.ageMinutes !== null)
    .sort((left, right) => {
      const leftRemaining = left.staleAfterMinutes - (left.ageMinutes ?? 0)
      const rightRemaining = right.staleAfterMinutes - (right.ageMinutes ?? 0)
      return leftRemaining - rightRemaining
    })[0]
  const label = score >= 82 ? '최신성 양호' : score >= 60 ? '일부 갱신 필요' : '최신성 점검 필요'
  const tone: DataFreshness['tone'] = score >= 82 ? 'positive' : score >= 60 ? 'warning' : 'negative'

  return {
    generatedAt: new Date(now).toISOString(),
    score,
    label,
    tone,
    summary:
      staleCount > 0
        ? `${staleCount}개 데이터 소스가 권장 갱신 기준을 넘겼습니다. 장전 판단 전 전체 새로고침을 먼저 실행하세요.`
        : missingCount > 0
          ? `${missingCount}개 데이터 소스의 수신 시간이 아직 없습니다. 연결 상태를 확인한 뒤 판단 강도를 낮춰 보세요.`
          : '모든 핵심 데이터가 권장 최신성 기준 안에 있습니다.',
    staleCount,
    missingCount,
    nextRefreshLabel: nextSource ? `${nextSource.name} ${Math.max(0, nextSource.staleAfterMinutes - (nextSource.ageMinutes ?? 0))}분 내 재확인` : '수신 후 계산',
    sources,
  }
}

const signalAuditSourceMeta: Record<
  ForecastImpact['source'],
  {
    label: string
    reliabilityId?: DataReliability['sources'][number]['id']
    localScore?: number
    localLabel?: string
  }
> = {
  indicator: {
    label: '선행지표',
    reliabilityId: 'quotes',
  },
  news: {
    label: '뉴스 이슈',
    reliabilityId: 'news',
  },
  disclosure: {
    label: 'DART 공시',
    reliabilityId: 'disclosures',
  },
  calendar: {
    label: '이벤트 일정',
    reliabilityId: 'calendar',
  },
  portfolio: {
    label: '내 포트폴리오',
    localScore: 88,
    localLabel: '브라우저 저장',
  },
}

function signedImpactLabel(value: number) {
  return `${value > 0 ? '+' : ''}${value}점`
}

function signalAuditConfidence(reliabilityScore: number, itemCount: number): SignalAuditSource['confidence'] {
  if (reliabilityScore >= 78 && itemCount >= 2) return 'high'
  if (reliabilityScore >= 45 && itemCount > 0) return 'medium'
  return 'low'
}

function buildSignalAudit({
  forecast,
  dataReliability,
}: {
  forecast: MarketForecast
  dataReliability: DataReliability
}): SignalAudit {
  const grouped = forecast.impacts.reduce(
    (acc, impact) => {
      const source = acc.get(impact.source) ?? []
      source.push(impact)
      acc.set(impact.source, source)
      return acc
    },
    new Map<ForecastImpact['source'], ForecastImpact[]>(),
  )
  const totalAbsoluteImpact = Math.max(
    1,
    forecast.impacts.reduce((sum, impact) => sum + Math.abs(impact.impact), 0),
  )
  const totalPositiveImpact = forecast.impacts.filter((impact) => impact.impact > 0).reduce((sum, impact) => sum + impact.impact, 0)
  const totalNegativeImpact = Math.abs(forecast.impacts.filter((impact) => impact.impact < 0).reduce((sum, impact) => sum + impact.impact, 0))
  const netImpact = totalPositiveImpact - totalNegativeImpact
  const sources = (Object.keys(signalAuditSourceMeta) as ForecastImpact['source'][]).map((sourceId): SignalAuditSource => {
    const meta = signalAuditSourceMeta[sourceId]
    const impacts = grouped.get(sourceId) ?? []
    const reliabilitySource = meta.reliabilityId ? dataReliability.sources.find((source) => source.id === meta.reliabilityId) : undefined
    const impactSum = impacts.reduce((sum, impact) => sum + impact.impact, 0)
    const positiveImpact = impacts.filter((impact) => impact.impact > 0).reduce((sum, impact) => sum + impact.impact, 0)
    const negativeImpact = Math.abs(impacts.filter((impact) => impact.impact < 0).reduce((sum, impact) => sum + impact.impact, 0))
    const reliabilityScore = reliabilitySource?.score ?? meta.localScore ?? 40
    const reliabilityLabel = reliabilitySource?.statusLabel ?? meta.localLabel ?? '확인 필요'
    const contributionPct = Math.round((impacts.reduce((sum, impact) => sum + Math.abs(impact.impact), 0) / totalAbsoluteImpact) * 100)
    const confidence = signalAuditConfidence(reliabilityScore, impacts.length)
    const tone = reliabilityScore < 45 ? 'warning' : impactSum > 0 ? 'positive' : impactSum < 0 ? 'negative' : 'neutral'

    return {
      id: sourceId,
      label: meta.label,
      itemCount: impacts.length,
      impactSum,
      positiveImpact,
      negativeImpact,
      contributionPct,
      reliabilityScore,
      reliabilityLabel,
      tone,
      confidence,
      summary:
        impacts.length > 0
          ? `${meta.label} ${impacts.length}개 근거가 예측에 ${signedImpactLabel(impactSum)} 반영됐습니다.`
          : `${meta.label}에서 현재 예측에 직접 반영된 근거는 없습니다.`,
      topEvidence: impacts
        .slice()
        .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
        .slice(0, 2)
        .map((impact) => `${impact.label} ${signedImpactLabel(impact.impact)} · ${impact.reason}`),
    }
  })
  const warnings = [
    ...sources
      .filter((source) => source.contributionPct >= 22 && source.reliabilityScore < 55)
      .map((source) => `${source.label} 기여도는 ${source.contributionPct}%인데 데이터 신뢰도가 낮습니다. 원자료 확인 후 판단하세요.`),
    totalPositiveImpact > 0 && totalNegativeImpact > 0 && Math.min(totalPositiveImpact, totalNegativeImpact) / Math.max(totalPositiveImpact, totalNegativeImpact) >= 0.55
      ? '상방과 하방 근거가 동시에 강합니다. 개장 직후 방향 확정 전까지 추격 주문은 줄이는 편이 좋습니다.'
      : null,
    dataReliability.score < 55 ? '전체 데이터 신뢰도가 낮아 예측은 실행보다 체크리스트에 가깝게 보세요.' : null,
  ].filter((item): item is string => Boolean(item))
  const focusList = forecast.impacts
    .slice()
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 5)
    .map((impact) => `${impact.label}: ${signedImpactLabel(impact.impact)} · ${impact.reason}`)

  return {
    generatedAt: new Date().toISOString(),
    totalPositiveImpact,
    totalNegativeImpact,
    netImpact,
    dominantDirection: signedDirection(netImpact),
    summary:
      netImpact > 0
        ? `상방 근거가 하방보다 ${signedImpactLabel(netImpact)} 우세합니다.`
        : netImpact < 0
          ? `하방 근거가 상방보다 ${signedImpactLabel(Math.abs(netImpact))} 강합니다.`
          : '상방과 하방 근거가 균형에 가깝습니다.',
    sources: sources.sort((a, b) => b.contributionPct - a.contributionPct || Math.abs(b.impactSum) - Math.abs(a.impactSum)),
    warnings: warnings.length > 0 ? warnings : ['현재 예측 근거와 데이터 품질 사이에 큰 충돌은 없습니다.'],
    focusList: focusList.length > 0 ? focusList : ['예측에 반영할 영향 요인이 아직 충분하지 않습니다. 시세와 뉴스 새로고침을 먼저 확인하세요.'],
  }
}

function directionFromForecastScore(score: number): Direction {
  if (score >= 58) return 'positive'
  if (score <= 43) return 'negative'
  return 'neutral'
}

function directionFromMarketChange(change: number): Direction {
  if (change >= 0.35) return 'positive'
  if (change <= -0.35) return 'negative'
  return 'neutral'
}

function directionReviewLabel(direction: Direction) {
  if (direction === 'positive') return '상승 우위'
  if (direction === 'negative') return '하락 압력'
  if (direction === 'mixed') return '혼재'
  return '보합권'
}

function forecastReviewTone(score: number): ForecastReview['tone'] {
  if (score >= 78) return 'positive'
  if (score >= 52) return 'warning'
  return 'negative'
}

function forecastReviewLabel(score: number) {
  if (score >= 82) return '예측 적중'
  if (score >= 62) return '부분 적중'
  if (score >= 42) return '방향 재점검'
  return '예측 빗나감'
}

function weightedHoldingChange(holdingsData: Holding[]) {
  const totalWeight = holdingsData.reduce((sum, holding) => sum + Math.max(0, holding.portfolioWeight), 0)
  if (totalWeight <= 0) return 0
  return holdingsData.reduce((sum, holding) => sum + holding.dayChange * Math.max(0, holding.portfolioWeight), 0) / totalWeight
}

function buildForecastReview({
  forecast,
  holdingsData,
  indicators,
  quoteMap,
  dataReliability,
  actionQueue,
  journal,
}: {
  forecast: MarketForecast
  holdingsData: Holding[]
  indicators: MarketIndicator[]
  quoteMap: Map<string, MarketQuote>
  dataReliability: DataReliability
  actionQueue: ActionQueueItem[]
  journal: InvestmentJournal
}): ForecastReview {
  const generatedAt = new Date().toISOString()
  const kospiQuote = getQuote(quoteMap, 'KOSPI')
  const kosdaqQuote = getQuote(quoteMap, 'KOSDAQ')
  const kospiChange = kospiQuote?.changePercent ?? null
  const holdingChange = weightedHoldingChange(holdingsData)
  const actualChange = kospiChange ?? holdingChange
  const actualSource = kospiChange !== null ? 'KOSPI' : '보유종목 가중 평균'
  const predictedDirection = directionFromForecastScore(forecast.baseScore)
  const actualDirection = directionFromMarketChange(actualChange)
  const directionMatched =
    predictedDirection === actualDirection ||
    (predictedDirection === 'neutral' && Math.abs(actualChange) < 0.55) ||
    (actualDirection === 'neutral' && forecast.baseScore >= 45 && forecast.baseScore <= 58)
  const oppositeDirection =
    (predictedDirection === 'positive' && actualDirection === 'negative') ||
    (predictedDirection === 'negative' && actualDirection === 'positive')
  const completedCount = journal.completedActionIds.filter((id) => actionQueue.some((item) => item.id === id)).length
  const actionCompletion = actionQueue.length > 0 ? Math.round((completedCount / actionQueue.length) * 100) : 100
  const reliabilityAdjustment = dataReliability.score >= 78 ? 8 : dataReliability.score < 45 ? -10 : 0
  const score = clamp(
    (directionMatched ? 74 : oppositeDirection ? 32 : 54) +
      (Math.abs(actualChange) <= 0.25 && predictedDirection === 'neutral' ? 10 : 0) +
      Math.round((actionCompletion - 50) * 0.12) +
      reliabilityAdjustment,
    0,
    100,
  )
  const topImpact = forecast.impacts[0]
  const topRisk = forecast.impacts.find((item) => item.impact < 0)
  const topPositive = forecast.impacts.find((item) => item.impact > 0)
  const strongestIndicator = [...indicators]
    .filter((indicator) => indicator.symbol !== 'KOSPI' && indicator.symbol !== 'KOSDAQ')
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
  const strongestHolding = [...holdingsData].sort((a, b) => b.dayChange - a.dayChange)[0]
  const weakestHolding = [...holdingsData].sort((a, b) => a.dayChange - b.dayChange)[0]
  const kosdaqText = kosdaqQuote?.changePercent !== null && kosdaqQuote?.changePercent !== undefined ? formatChange(kosdaqQuote.changePercent) : '수집 대기'
  const summary = directionMatched
    ? `${forecast.openingBias} 예측과 ${actualSource} 흐름이 대체로 맞았습니다.`
    : oppositeDirection
      ? `${forecast.openingBias} 예측과 ${actualSource} 흐름이 반대로 움직였습니다. 핵심 변수 재점검이 필요합니다.`
      : `${forecast.openingBias} 예측은 일부만 맞았습니다. 실제 움직임은 보합권에 가까웠습니다.`
  const signals: ForecastReview['signals'] = [
    {
      id: 'predicted-direction',
      label: '예측 방향',
      value: directionReviewLabel(predictedDirection),
      tone: directionVariant(predictedDirection),
      summary: `방향점수 ${forecast.baseScore}/100, 예상 출발 ${forecast.expectedOpenRange}`,
    },
    {
      id: 'actual-direction',
      label: actualSource,
      value: formatChange(actualChange),
      tone: directionVariant(actualDirection),
      summary: kospiQuote ? `KOSPI ${formatIndicatorValue('KOSPI', kospiQuote.price)} 기준` : 'KOSPI 수집 전에는 보유종목 흐름으로 대체합니다.',
    },
    {
      id: 'kosdaq',
      label: 'KOSDAQ',
      value: kosdaqText,
      tone: kosdaqQuote?.changePercent === null || kosdaqQuote?.changePercent === undefined ? 'neutral' : directionVariant(directionFromMarketChange(kosdaqQuote.changePercent)),
      summary: '성장주 체감 흐름과 관심종목 판단 보조 기준입니다.',
    },
    {
      id: 'portfolio',
      label: '보유종목 체감',
      value: formatChange(holdingChange),
      tone: directionVariant(directionFromMarketChange(holdingChange)),
      summary: strongestHolding && weakestHolding ? `강세 ${strongestHolding.name} ${formatChange(strongestHolding.dayChange)} / 약세 ${weakestHolding.name} ${formatChange(weakestHolding.dayChange)}` : '보유종목 수집 대기',
    },
    {
      id: 'leading-indicator',
      label: '주요 선행지표',
      value: strongestIndicator ? `${strongestIndicator.symbol} ${formatChange(strongestIndicator.change)}` : '수집 대기',
      tone: strongestIndicator ? directionVariant(strongestIndicator.direction) : 'neutral',
      summary: strongestIndicator?.note ?? '야간 지표 수집 대기',
    },
    {
      id: 'action-completion',
      label: '액션 실행',
      value: `${completedCount}/${actionQueue.length}`,
      tone: actionCompletion >= 70 ? 'positive' : actionCompletion > 0 ? 'warning' : 'neutral',
      summary: '체크리스트 완료율은 예측보다 실행 품질을 보여줍니다.',
    },
  ]
  const reviewLines = [
    `[${getKstDateKey()} 예측 검증]`,
    `판정: ${forecastReviewLabel(score)} (${score}/100)`,
    `예측: ${forecast.openingBias} / 실제: ${actualSource} ${formatChange(actualChange)}`,
    `데이터 신뢰도: ${dataReliability.score}/100 (${dataReliability.label})`,
    topImpact ? `핵심 변수: ${topImpact.label} (${topImpact.impact > 0 ? '+' : ''}${topImpact.impact}점) - ${topImpact.reason}` : null,
    topPositive ? `맞은 근거: ${topPositive.label} 유지 여부를 확인` : null,
    topRisk ? `놓치기 쉬운 리스크: ${topRisk.label} 확대 여부 확인` : null,
    strongestHolding && weakestHolding ? `보유 체감: 강세 ${strongestHolding.name} ${formatChange(strongestHolding.dayChange)}, 약세 ${weakestHolding.name} ${formatChange(weakestHolding.dayChange)}` : null,
    `액션 실행: ${completedCount}/${actionQueue.length}개 완료`,
    directionMatched ? '다음 개선: 같은 조건이 반복되면 포지션 크기를 조금 더 명확히 정한다.' : '다음 개선: 예측과 반대로 움직인 지표/뉴스/수급 변수를 장전 체크리스트에 추가한다.',
  ].filter((line): line is string => Boolean(line))

  return {
    generatedAt,
    score,
    label: forecastReviewLabel(score),
    tone: forecastReviewTone(score),
    predictedDirection,
    actualDirection,
    predictedLabel: directionReviewLabel(predictedDirection),
    actualLabel: `${actualSource} ${formatChange(actualChange)}`,
    summary,
    signals,
    reviewDraft: reviewLines.join('\n'),
    nextQuestions: [
      directionMatched ? '오늘 맞았던 핵심 변수는 내일도 반복 가능한 조건인가?' : '예측과 반대로 움직인 가장 큰 원인은 지표, 뉴스, 수급 중 무엇인가?',
      '개장 30분 판단과 종가 결과 사이에 달라진 변수가 있었나?',
      '체크리스트에서 실제 매매 결정에 도움 된 항목과 불필요한 항목은 무엇인가?',
    ],
  }
}

function executionRate(item: Pick<JournalHistoryItem, 'completedActionCount' | 'totalActionCount'>) {
  if (item.totalActionCount <= 0) return item.completedActionCount > 0 ? 100 : 0
  return clamp(Math.round((item.completedActionCount / item.totalActionCount) * 100), 0, 100)
}

function calibrationTone(score: number): ForecastCalibration['tone'] {
  if (score >= 78) return 'positive'
  if (score >= 58) return 'warning'
  return 'negative'
}

function calibrationLabel(score: number, sampleCount: number) {
  if (sampleCount === 0) return '학습 대기'
  if (score >= 78) return '예측 안정'
  if (score >= 58) return '보정 필요'
  return '복기 강화'
}

function buildForecastCalibration({
  history,
  currentReview,
}: {
  history: JournalHistoryItem[]
  currentReview: ForecastReview
}): ForecastCalibration {
  const sample = history.slice(0, 20)
  const sampleCount = sample.length
  const averageScore = sampleCount > 0 ? Math.round(sample.reduce((sum, item) => sum + item.forecastScore, 0) / sampleCount) : currentReview.score
  const hitRate = sampleCount > 0 ? Math.round((sample.filter((item) => item.forecastScore >= 62).length / sampleCount) * 100) : 0
  const actionCompletionRate = sampleCount > 0 ? Math.round(sample.reduce((sum, item) => sum + executionRate(item), 0) / sampleCount) : 0
  const blendedScore = sampleCount > 0 ? Math.round(averageScore * 0.65 + actionCompletionRate * 0.25 + hitRate * 0.1) : currentReview.score
  const weakExecution = sampleCount > 0 && actionCompletionRate < 55
  const weakForecast = sampleCount > 0 && averageScore < 58
  const strongForecast = sampleCount >= 3 && averageScore >= 72 && actionCompletionRate >= 65
  const recent = sample.slice(0, 6).map((item) => ({
    id: item.id,
    dateLabel: item.date.slice(5).replace('-', '.'),
    forecastLabel: item.forecastLabel,
    forecastScore: item.forecastScore,
    tone: forecastReviewTone(item.forecastScore),
    executionRate: executionRate(item),
    summary: item.forecastSummary,
  }))
  const nextFocus = uniqueBriefItems(
    [
      weakForecast ? '예측이 빗나간 날의 선행지표와 실제 KOSPI/KOSDAQ 괴리를 먼저 복기' : null,
      weakExecution ? '액션 큐 실행률을 높이기 위해 장전 체크 항목을 3개 이하로 압축' : null,
      currentReview.score < 62 ? '오늘 검증 리포트의 개선 질문을 장후 리뷰에 반영' : null,
      strongForecast ? '현재 룰은 유지하고 비중/실행 타이밍 기록을 더 세밀하게 누적' : null,
      '저장된 복기 히스토리를 주 1회 확인해 반복 실수와 강한 신호를 분리',
    ],
    4,
  )

  return {
    generatedAt: new Date().toISOString(),
    sampleCount,
    averageScore,
    hitRate,
    actionCompletionRate,
    currentScore: currentReview.score,
    currentLabel: currentReview.label,
    tone: calibrationTone(blendedScore),
    label: calibrationLabel(blendedScore, sampleCount),
    summary:
      sampleCount === 0
        ? `아직 저장된 복기 표본이 없습니다. 현재 검증 점수는 ${currentReview.score}/100이며, 오늘 기록을 보관하면 캘리브레이션이 시작됩니다.`
        : `최근 ${sampleCount}개 복기 기준 평균 ${averageScore}점, 적중률 ${hitRate}%, 실행률 ${actionCompletionRate}%입니다.`,
    lesson: weakForecast
      ? '예측 점수가 낮은 날은 방향보다 실제 수급과 보유종목 반응을 먼저 재점검해야 합니다.'
      : weakExecution
        ? '예측보다 실행률이 병목입니다. 장전 액션을 줄이고 완료 여부를 더 엄격히 기록하는 편이 좋습니다.'
        : strongForecast
          ? '예측과 실행이 모두 안정권입니다. 지금은 룰을 크게 바꾸기보다 표본을 더 쌓는 구간입니다.'
          : '예측과 실행 모두 개선 여지가 있습니다. 장후 리뷰에서 놓친 지표와 실행하지 못한 액션을 분리해 기록하세요.',
    nextFocus,
    recent,
  }
}

function executionSideLabel(side: ExecutionPlanItem['side']) {
  if (side === 'buy') return '분할 매수'
  if (side === 'sell') return '일부 축소'
  if (side === 'hold') return '보유 유지'
  return '대기'
}

function executionSideVariant(side: ExecutionPlanItem['side']): 'positive' | 'negative' | 'warning' | 'neutral' | 'secondary' {
  if (side === 'buy') return 'positive'
  if (side === 'sell') return 'warning'
  if (side === 'hold') return 'neutral'
  return 'secondary'
}

function marketValueKrwFromPrice(price: number, market: 'KR' | 'US', usdKrw: number) {
  return market === 'US' ? price * usdKrw : price
}

function executionQuantityGuide(side: ExecutionPlanItem['side'], budgetKrw: number, price: number, market: 'KR' | 'US', usdKrw: number) {
  if (budgetKrw <= 0 || price <= 0) return side === 'hold' ? '수량 유지' : '수량 없음'

  const unitKrw = marketValueKrwFromPrice(price, market, usdKrw)
  const quantity = budgetKrw / unitKrw
  if (quantity < 1 && market === 'US') return `${round(quantity, 2)}주 이내`
  return `${Math.max(1, Math.floor(quantity)).toLocaleString('ko-KR')}주 이내`
}

function executionPriceBandForHolding(holding: Holding) {
  const reboundLine = holding.currentPrice * 1.01
  const defenseLine = holding.averagePrice * 0.97
  return `${formatCurrency(defenseLine, holding.market)} ~ ${formatCurrency(reboundLine, holding.market)}`
}

function executionPriceBandForWatch(item: WatchItem) {
  const low = item.targetBuyPrice * 0.985
  const high = item.targetBuyPrice * 1.015
  return `${formatCurrency(low, defaultMarketForSymbol(item.symbol))} ~ ${formatCurrency(high, defaultMarketForSymbol(item.symbol))}`
}

function buildExecutionPlan({
  portfolioPlaybook,
  holdingsData,
  watchlistData,
  forecast,
  dataReliability,
  actionQueue,
  usdKrw,
}: {
  portfolioPlaybook: PortfolioPlaybook
  holdingsData: Holding[]
  watchlistData: WatchItem[]
  forecast: MarketForecast
  dataReliability: DataReliability
  actionQueue: ActionQueueItem[]
  usdKrw: number
}): ExecutionPlan {
  const generatedAt = new Date().toISOString()
  const reliabilityScale = dataReliability.score >= 78 ? 1 : dataReliability.score >= 55 ? 0.75 : dataReliability.score >= 35 ? 0.45 : 0.2
  const confidenceScale = forecast.confidence === 'high' ? 1 : forecast.confidence === 'medium' ? 0.8 : 0.55
  const stanceBase =
    portfolioPlaybook.stance === 'risk-on'
      ? 0.08
      : portfolioPlaybook.stance === 'balanced'
        ? 0.045
        : 0.012
  const maxNewCapitalKrw = Math.round(portfolioPlaybook.totalValueKrw * stanceBase * reliabilityScale * confidenceScale)
  const riskBudgetKrw = Math.round(
    portfolioPlaybook.totalValueKrw *
      (portfolioPlaybook.stance === 'defensive' ? 0.0035 : portfolioPlaybook.stance === 'balanced' ? 0.006 : 0.009),
  )
  const buyCandidates = portfolioPlaybook.positionPlans.filter((item) => item.action === 'add-ready')
  const buyBudgetPerItem = buyCandidates.length > 0 ? Math.round(maxNewCapitalKrw / buyCandidates.length) : 0
  const urgentRisk = portfolioPlaybook.riskSignals.some((signal) => signal.severity === 'critical' || signal.severity === 'high')

  const items = portfolioPlaybook.positionPlans.slice(0, 8).map((plan): ExecutionPlanItem => {
    const holding = holdingsData.find((item) => item.symbol === plan.symbol)
    const watchItem = watchlistData.find((item) => item.symbol === plan.symbol)
    const market = holding?.market ?? (watchItem ? defaultMarketForSymbol(watchItem.symbol) : defaultMarketForSymbol(plan.symbol))
    const currentPrice = holding?.currentPrice ?? watchItem?.currentPrice ?? 0
    const side: ExecutionPlanItem['side'] =
      plan.action === 'add-ready'
        ? portfolioPlaybook.stance === 'defensive' || dataReliability.score < 35
          ? 'wait'
          : 'buy'
        : plan.action === 'trim-watch'
          ? 'sell'
          : plan.action === 'hold'
            ? 'hold'
            : 'wait'
    const holdingValueKrw = holding ? holdingMarketValueKrw(holding, usdKrw) : 0
    const budgetKrw =
      side === 'buy'
        ? Math.min(buyBudgetPerItem, Math.round(portfolioPlaybook.totalValueKrw * 0.035))
        : side === 'sell' && holding
          ? Math.round(holdingValueKrw * (plan.priority === 'high' || urgentRisk ? 0.18 : 0.1))
          : 0
    const priceBand = holding ? executionPriceBandForHolding(holding) : watchItem ? executionPriceBandForWatch(watchItem) : '가격 확인'
    const quantityGuide = executionQuantityGuide(side, budgetKrw, currentPrice, market, usdKrw)
    const confidence: ExecutionPlanItem['confidence'] =
      dataReliability.score >= 75 && forecast.confidence !== 'low'
        ? 'high'
        : dataReliability.score >= 45
          ? 'medium'
          : 'low'

    return {
      id: `execution-${plan.id}`,
      symbol: plan.symbol,
      name: plan.name,
      market,
      side,
      priority: plan.priority,
      confidence,
      budgetKrw,
      quantityGuide,
      priceBand,
      trigger: plan.trigger,
      riskRule:
        side === 'buy'
          ? '체결 후 지수 대비 약세 전환 또는 가격대 하단 이탈 시 추가 매수 중단'
          : side === 'sell'
            ? '시초가 반등 실패, 환율/VIX 재상승, 지수 대비 약세가 겹치면 일부 축소'
            : side === 'hold'
              ? '상대강도 유지 시 보유, 지수보다 약해지면 신규 매수 금지'
              : '조건 충족 전까지 주문 없음',
      reason: plan.reason,
      relatedSignals: [forecast.openingBias, dataReliability.label, ...portfolioPlaybook.riskSignals.slice(0, 2).map((signal) => signal.title)],
    }
  })
  const plannedBuyKrw = items.filter((item) => item.side === 'buy').reduce((sum, item) => sum + item.budgetKrw, 0)
  const plannedTrimKrw = items.filter((item) => item.side === 'sell').reduce((sum, item) => sum + item.budgetKrw, 0)
  const netExposureKrw = plannedBuyKrw - plannedTrimKrw
  const guardrails = [
    portfolioPlaybook.stance === 'defensive' ? '방어 우선: 신규 진입은 원칙적으로 보류하고 축소 감시 종목부터 확인' : null,
    dataReliability.score < 55 ? '데이터 신뢰도 낮음: 계획 금액의 절반 이하만 사용하거나 확인 전 대기' : null,
    forecast.confidence === 'low' ? '예측 신뢰도 낮음: 가격대보다 트리거 충족 여부를 우선' : null,
    urgentRisk ? '고위험 신호 있음: 첫 30분은 고비중/약세 종목 방어선 확인' : null,
    actionQueue.some((item) => item.priority === 'critical') ? '긴급 액션 큐가 있으면 실행 계획보다 먼저 처리' : null,
    '시장가 주문보다 지정가/분할 기준을 우선하고, 체결 전 환율·VIX·SOX 변화를 다시 확인',
  ].filter((item): item is string => Boolean(item))
  const summary =
    netExposureKrw > 0
      ? `신규 노출은 최대 ${formatKrwAmount(plannedBuyKrw)}원, 축소 후보는 ${formatKrwAmount(plannedTrimKrw)}원입니다.`
      : plannedTrimKrw > 0
        ? `오늘은 신규 노출보다 ${formatKrwAmount(plannedTrimKrw)}원 규모의 축소 감시가 먼저입니다.`
        : '오늘은 주문보다 조건 확인과 보유 유지가 중심입니다.'
  const copyText = [
    `[Tracking Money 내일 실행 계획 · ${briefDateLabel(generatedAt)}]`,
    `${portfolioPlaybook.stanceLabel}: ${summary}`,
    `신규 한도: ${formatKrwAmount(maxNewCapitalKrw)}원 / 리스크 예산: ${formatKrwAmount(riskBudgetKrw)}원`,
    '',
    '[종목별 계획]',
    ...items.map(
      (item) =>
        `- ${item.symbol} ${executionSideLabel(item.side)}: ${item.quantityGuide}, ${formatKrwAmount(item.budgetKrw)}원 / ${item.priceBand} / ${item.trigger}`,
    ),
    '',
    '[가드레일]',
    ...guardrails.map((item) => `- ${item}`),
  ].join('\n')

  return {
    generatedAt,
    stance: portfolioPlaybook.stance,
    stanceLabel: portfolioPlaybook.stanceLabel,
    summary,
    maxNewCapitalKrw,
    plannedBuyKrw,
    plannedTrimKrw,
    netExposureKrw,
    riskBudgetKrw,
    guardrails,
    items,
    copyText,
  }
}

function buildDashboardSnapshot({
  baseHoldings,
  baseWatchlist,
  userCalendarEvents,
  newsKeywordsData,
  alertRulesData,
  alertSettingsData,
  alertHistoryData,
  journalHistoryData,
  quotes,
  fetchedAt,
  newsFetchedAt,
  calendarFetchedAt,
  disclosureFetchedAt,
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
  now,
}: {
  baseHoldings: Holding[]
  baseWatchlist: WatchItem[]
  userCalendarEvents: CalendarEvent[]
  newsKeywordsData: string[]
  alertRulesData: AlertRule[]
  alertSettingsData: AlertSettings
  alertHistoryData: AlertHistoryItem[]
  journalHistoryData: JournalHistoryItem[]
  quotes: MarketQuote[]
  fetchedAt: string | null
  newsFetchedAt: string | null
  calendarFetchedAt: string | null
  disclosureFetchedAt: string | null
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
  now: Date
}): DashboardSnapshot {
  const quoteMap = quoteBySymbol(quotes)
  const liveHoldings = mergeHoldingsWithQuotes(baseHoldings, quoteMap)
  const liveWatchlist = mergeWatchlistWithQuotes(baseWatchlist, quoteMap)
  const liveIndicators = mergeIndicatorsWithQuotes(quoteMap)
  const newsImpactBoard = buildSymbolNewsImpactBoard(liveNews, liveHoldings, liveWatchlist)
  const catalystRadar = buildCatalystRadar({
    liveNews,
    calendarEventsData,
    disclosures,
    holdingsData: liveHoldings,
    watchlistData: liveWatchlist,
  })
  const liveBiasScore = applyNewsBiasFactor(
    buildLiveBiasScore(liveIndicators, quotes.length),
    buildNewsBiasFactor(liveNews, liveHoldings, liveWatchlist),
  )
  const koreaMarketBridge = buildKoreaMarketBridge(liveIndicators, liveHoldings, liveWatchlist, liveBiasScore)
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
  const usdKrw = getQuote(quoteMap, 'USD/KRW')?.price ?? Number(marketStatus.usdKrw.replace(/,/g, ''))
  const portfolioPlaybook = buildPortfolioPlaybook({
    holdingsData: liveHoldings,
    watchlistData: liveWatchlist,
    indicators: liveIndicators,
    biasScoreData: liveBiasScore,
    forecast,
    newsItems: liveNews,
    disclosures,
    usdKrw,
  })
  const forecastSensitivity = buildForecastSensitivity({
    forecast,
    koreaMarketBridge,
    newsImpactBoard,
    portfolioPlaybook,
  })
  const overnightStressTest = buildOvernightStressTest({
    forecast,
    koreaMarketBridge,
    forecastSensitivity,
    newsImpactBoard,
    holdingsData: liveHoldings,
    indicators: liveIndicators,
    usdKrw,
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
  const triggeredAlerts = buildTriggeredAlerts({
    alertRulesData,
    holdingsData: liveHoldings,
    watchlistData: liveWatchlist,
    indicators: liveIndicators,
    newsItems: liveNews,
    biasScoreData: liveBiasScore,
  })
  const marketPulse = buildMarketPulseRail({
    indicators: liveIndicators,
    radar: catalystRadar,
    alerts: triggeredAlerts,
  })
  const marketStatusView = buildMarketStatusView({ quoteMap, fetchedAt, quoteStatus })
  const expectedQuoteCount = new Set([...baseHoldings.map((holding) => holding.symbol), ...baseWatchlist.map((item) => item.symbol), ...indicatorSymbols]).size
  const dataReliability = buildDataReliability({
    quoteStatus,
    quoteMessage,
    liveQuoteCount: quotes.length,
    expectedQuoteCount,
    newsStatus,
    newsMessage,
    liveNewsCount: liveNews.length,
    calendarStatus,
    calendarMessage,
    calendarEventCount: calendarEventsData.length,
    disclosureStatus,
    disclosureMessage,
    disclosureCount: disclosures.length,
  })
  const dataFreshness = buildDataFreshness({
    dataReliability,
    quoteFetchedAt: fetchedAt,
    newsFetchedAt,
    calendarFetchedAt,
    disclosureFetchedAt,
  })
  const signalAudit = buildSignalAudit({
    forecast,
    dataReliability,
  })
  const executionPlan = buildExecutionPlan({
    portfolioPlaybook,
    holdingsData: liveHoldings,
    watchlistData: liveWatchlist,
    forecast,
    dataReliability,
    actionQueue,
    usdKrw,
  })
  const morningBrief = buildMorningBrief({
    forecast,
    portfolioPlaybook,
    actionQueue,
    triggeredAlerts,
    newsItems: liveNews,
    eventsData: calendarEventsData,
    disclosures,
    marketStatusData: marketStatusView,
    dataReliability,
    executionPlan,
  })
  const preMarketCommand = buildPreMarketCommandCenter({
    forecast,
    forecastSensitivity,
    koreaMarketBridge,
    newsImpactBoard,
    portfolioPlaybook,
    actionQueue,
    executionPlan,
    dataReliability,
    marketStatusData: marketStatusView,
  })
  const forecastReview = buildForecastReview({
    forecast,
    holdingsData: liveHoldings,
    indicators: liveIndicators,
    quoteMap,
    dataReliability,
    actionQueue,
    journal,
  })
  const forecastCalibration = buildForecastCalibration({
    history: journalHistoryData,
    currentReview: forecastReview,
  })
  const marketSession = buildMarketSessionControl({
    now,
    forecast,
    marketPulse,
    actionQueue,
    dataFreshness,
    executionPlan,
    portfolioPlaybook,
    forecastReview,
  })
  return {
    holdings: liveHoldings,
    watchlist: liveWatchlist,
    newsKeywords: newsKeywordsData,
    alertRules: alertRulesData,
    alertSettings: alertSettingsData,
    alertHistory: alertHistoryData,
    triggeredAlerts,
    storedData: {
      holdings: baseHoldings,
      watchlist: baseWatchlist,
      calendarEvents: userCalendarEvents,
      newsKeywords: newsKeywordsData,
      alertRules: alertRulesData,
      alertSettings: alertSettingsData,
      alertHistory: alertHistoryData,
      journal,
      journalHistory: journalHistoryData,
    },
    leadingIndicators: liveIndicators,
    biasScore: liveBiasScore,
    marketStatus: marketStatusView,
    quoteStatus,
    quoteMessage,
    liveQuoteCount: quotes.length,
    usdKrw,
    fetchedAt,
    calendarEvents: calendarEventsData,
    calendarStatus,
    calendarMessage,
    liveNews,
    newsStatus,
    newsMessage,
    newsImpactBoard,
    catalystRadar,
    marketPulse,
    disclosures,
    disclosureStatus,
    disclosureMessage,
    forecast,
    portfolioPlaybook,
    morningBrief,
    dataReliability,
    dataFreshness,
    signalAudit,
    koreaMarketBridge,
    forecastSensitivity,
    overnightStressTest,
    forecastReview,
    forecastCalibration,
    executionPlan,
    preMarketCommand,
    marketSession,
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

function PreMarketCommandCenterPanel({ command, compact = false }: { command: PreMarketCommandCenter; compact?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const visibleSteps = compact ? command.steps.slice(0, 4) : command.steps

  function copyCommandFallback(text: string) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)
    const copied = document.execCommand('copy')
    textArea.remove()
    if (!copied) throw new Error('fallback copy failed')
  }

  async function copyCommand() {
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(command.copyText)
      } catch {
        copyCommandFallback(command.copyText)
      }
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 2400)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>장전 운전석</CardTitle>
            <CardDescription>{command.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={command.gateTone}>{command.modeLabel}</Badge>
            <Badge variant="secondary">{formatNewsTime(command.generatedAt)}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyCommand()}>
              {copyState === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copyState === 'copied' ? '복사됨' : copyState === 'error' ? '복사 실패' : '복사'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          {command.metrics.map((metric) => (
            <div key={metric.label} className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">{metric.label}</div>
              <div className="mt-2 text-xl font-semibold">{metric.value}</div>
              <Badge className="mt-3" variant={metric.tone}>
                {metric.detail}
              </Badge>
            </div>
          ))}
        </div>

        <div
          className={cn(
            'grid min-w-0 gap-4',
            compact ? '2xl:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]',
          )}
        >
          <div className="grid min-w-0 gap-3">
            {visibleSteps.map((step) => (
              <div key={step.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{step.order}</Badge>
                      <Badge variant={step.tone}>{step.timeLabel}</Badge>
                      <Badge variant={actionPriorityVariant(step.priority)}>{actionPriorityLabel[step.priority]}</Badge>
                      <span className="text-sm font-semibold">{step.title}</span>
                    </div>
                    <div className="mt-2 text-sm leading-5">{step.action}</div>
                    {!compact ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{step.trigger}</div> : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="size-4" />
                    <span>{step.evidence}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {step.relatedSymbols.map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-md border border-positive/25 bg-positive/10 p-3">
              <div className="text-xs font-medium text-positive">진입 조건</div>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                {command.goConditions.map((item) => (
                  <div key={item} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-positive" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-negative/25 bg-negative/10 p-3">
              <div className="text-xs font-medium text-negative">보류·방어 조건</div>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                {command.stopConditions.map((item) => (
                  <div key={item} className="flex gap-2">
                    <X className="mt-0.5 size-4 shrink-0 text-negative" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">집중 심볼</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {command.focusSymbols.map((symbol) => (
                  <Badge key={symbol} variant="neutral">
                    {symbol}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const sensitivityCategoryLabel: Record<ForecastSensitivity['factors'][number]['category'], string> = {
  indicator: '지표',
  news: '뉴스',
  portfolio: '보유',
}

function ForecastSensitivityPanel({ sensitivity, compact = false }: { sensitivity: ForecastSensitivity; compact?: boolean }) {
  const visibleFactors = compact ? sensitivity.factors.slice(0, 4) : sensitivity.factors

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>예측 민감도·전환조건</CardTitle>
            <CardDescription>{sensitivity.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={sensitivity.upsideGap === 0 ? 'positive' : 'neutral'}>상방 {sensitivity.upsideTarget}</Badge>
            <Badge variant={sensitivity.downsideGap === 0 ? 'negative' : 'neutral'}>방어 {sensitivity.downsideTarget}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">현재 점수</div>
            <div className="mt-2 text-2xl font-semibold">{sensitivity.baseScore}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">상방 전환까지</div>
            <div className="mt-2 text-2xl font-semibold">{sensitivity.upsideGap === 0 ? '도달' : `+${sensitivity.upsideGap}`}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">방어 전환까지</div>
            <div className="mt-2 text-2xl font-semibold">{sensitivity.downsideGap === 0 ? '진입' : `-${sensitivity.downsideGap}`}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">핵심 전환 변수</div>
            <div className="mt-2 text-sm font-semibold leading-5">
              {sensitivity.topUpsideFactor} / {sensitivity.topDownsideFactor}
            </div>
          </div>
        </div>

        <div className={cn('grid gap-4', compact ? 'xl:grid-cols-[minmax(0,1fr)_280px]' : 'xl:grid-cols-[minmax(0,1fr)_340px]')}>
          <div className="grid gap-2">
            {visibleFactors.map((factor) => (
              <div key={factor.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{factor.symbol}</span>
                      <span className="text-sm font-medium">{factor.label}</span>
                      <Badge variant="secondary">{sensitivityCategoryLabel[factor.category]}</Badge>
                      <Badge variant={factor.tone}>{factor.currentImpact > 0 ? `+${factor.currentImpact}` : factor.currentImpact}</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-5 text-muted-foreground">{factor.note}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Badge variant="positive">상방 +{factor.upsideDelta}</Badge>
                    <Badge variant="negative">하방 {factor.downsideDelta}</Badge>
                  </div>
                </div>
                {!compact ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-positive/20 bg-positive/10 p-2 text-xs leading-5">
                      {factor.upsideTrigger}
                    </div>
                    <div className="rounded-md border border-negative/20 bg-negative/10 p-2 text-xs leading-5">
                      {factor.downsideTrigger}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {factor.watchSymbols.slice(0, compact ? 4 : 6).map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border bg-muted/10 p-3">
            <div className="text-xs font-medium text-muted-foreground">전환 체크리스트</div>
            <div className="mt-3 grid gap-2 text-sm leading-5">
              {sensitivity.transitionChecklist.map((item) => (
                <div key={item} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OvernightStressTestPanel({ stress, compact = false }: { stress: OvernightStressTest; compact?: boolean }) {
  const visiblePositions = compact ? stress.positions.slice(0, 4) : stress.positions
  const visibleScenarios = compact ? stress.scenarios.slice(0, 3) : stress.scenarios

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>야간 스트레스 테스트</CardTitle>
            <CardDescription>{stress.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={stress.stressTone}>{stress.stressLabel}</Badge>
            <Badge variant="secondary">{formatNewsTime(stress.generatedAt)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">스트레스 점수</div>
            <div className="mt-2 text-2xl font-semibold">{stress.stressScore}</div>
            <Badge className="mt-3" variant={stress.stressTone}>
              기준 {stress.baseScore} → {stress.stressScore}
            </Badge>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">KOSPI 압박 범위</div>
            <div className="mt-2 text-xl font-semibold">{stress.expectedKospiRange}</div>
            <div className="mt-2 text-xs text-muted-foreground">KOSDAQ {stress.expectedKosdaqRange}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">포트폴리오 충격</div>
            <div className="mt-2 text-xl font-semibold">{formatSignedKrwAmount(stress.portfolioImpactKrw)}</div>
            <Badge className="mt-3" variant={stress.portfolioImpactPercent < 0 ? 'negative' : 'positive'}>
              {formatChange(stress.portfolioImpactPercent)}
            </Badge>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">최대 방어선</div>
            <div className="mt-2 text-xl font-semibold">{formatSignedKrwAmount(stress.maxDrawdownKrw)}</div>
            <Badge className="mt-3" variant={stress.maxDrawdownPercent < 0 ? 'negative' : 'neutral'}>
              {formatChange(stress.maxDrawdownPercent)}
            </Badge>
          </div>
        </div>

        <div
          className={cn(
            'grid min-w-0 gap-4',
            compact ? '2xl:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]',
          )}
        >
          <div className="grid min-w-0 gap-3">
            {visibleScenarios.map((scenario) => (
              <div key={scenario.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={scenario.tone}>{scenario.label}</Badge>
                      <Badge variant="secondary">
                        {scenario.scoreDelta > 0 ? '+' : ''}
                        {scenario.scoreDelta}점
                      </Badge>
                      <span className="text-sm font-semibold">{scenario.kospiRange}</span>
                    </div>
                    <div className="mt-2 text-sm leading-5 text-muted-foreground">{scenario.summary}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Badge variant={scenario.portfolioImpactPercent < 0 ? 'negative' : 'positive'}>{formatChange(scenario.portfolioImpactPercent)}</Badge>
                    <Badge variant="secondary">{formatSignedKrwAmount(scenario.portfolioImpactKrw)}</Badge>
                  </div>
                </div>
                {!compact ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {scenario.triggers.map((trigger) => (
                      <div key={trigger} className="rounded-md border border-border bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                        {trigger}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {scenario.topAffectedSymbols.map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">민감 포지션</div>
              <div className="mt-3 grid gap-3">
                {visiblePositions.map((position) => (
                  <div key={position.symbol} className="rounded-md border border-border bg-background/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{position.symbol}</span>
                          <Badge variant="secondary">{position.weight}%</Badge>
                        </div>
                        <div className="mt-1 text-sm font-medium">{position.name}</div>
                      </div>
                      <Badge variant={position.tone}>{formatChange(position.stressImpactPercent)}</Badge>
                    </div>
                    <Progress className="mt-3" value={clamp(Math.abs(position.stressImpactPercent) * 14, 4, 100)} />
                    {!compact ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{position.note}</div> : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-negative/25 bg-negative/10 p-3">
              <div className="text-xs font-medium text-negative">방어 체크</div>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                {stress.hedgeChecklist.slice(0, compact ? 3 : stress.hedgeChecklist.length).map((item) => (
                  <div key={item} className="flex gap-2">
                    <X className="mt-0.5 size-4 shrink-0 text-negative" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">야간 집중 심볼</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {stress.focusSymbols.map((symbol) => (
                  <Badge key={symbol} variant="neutral">
                    {symbol}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ScenarioSimulatorPanel({
  forecast,
  holdingsData,
  indicators,
  newsImpactBoard,
  usdKrw,
}: {
  forecast: MarketForecast
  holdingsData: Holding[]
  indicators: MarketIndicator[]
  newsImpactBoard: NewsImpactBoard
  usdKrw: number
}) {
  const [shocks, setShocks] = useState<ScenarioShockState>(() => ({ ...defaultScenarioShocks }))
  const indicatorMap = useMemo(() => new Map(indicators.map((indicator) => [indicator.symbol, indicator])), [indicators])
  const result = useMemo(
    () =>
      buildScenarioSimulation({
        forecast,
        holdingsData,
        newsImpactBoard,
        shocks,
        usdKrw,
      }),
    [forecast, holdingsData, newsImpactBoard, shocks, usdKrw],
  )

  function updateShock(symbol: ScenarioShockSymbol, value: string) {
    const parsed = Number(value)
    const control = scenarioShockControls.find((item) => item.symbol === symbol)
    setShocks((current) => ({
      ...current,
      [symbol]: Number.isFinite(parsed) ? clamp(parsed, control?.min ?? -10, control?.max ?? 10) : 0,
    }))
  }

  function applyPreset(nextShocks: ScenarioShockState) {
    setShocks({ ...nextShocks })
  }

  return (
    <Card data-testid="scenario-simulator">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>가정 시뮬레이터</CardTitle>
            <CardDescription>{result.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset({ SOX: -1.5, 'NQ=F': -1, 'USD/KRW': 0.6, VIX: 4, US10Y: 0.75 })}
            >
              <TrendingDown className="size-4" />
              위험회피
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset({ SOX: 1.2, 'NQ=F': 0.8, 'USD/KRW': -0.4, VIX: -3, US10Y: -0.5 })}
            >
              <TrendingUp className="size-4" />
              안정회복
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(defaultScenarioShocks)}>
              <RefreshCw className="size-4" />
              초기화
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">가정 점수</div>
            <div className="mt-2 text-2xl font-semibold">{result.score}</div>
            <Badge className="mt-3" variant={result.scoreTone}>
              {result.scoreDelta > 0 ? '+' : ''}
              {result.scoreDelta}점
            </Badge>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">예상 범위</div>
            <div className="mt-2 text-xl font-semibold">{result.kospiRange}</div>
            <div className="mt-2 text-xs text-muted-foreground">KOSDAQ {result.kosdaqRange}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">포트폴리오 영향</div>
            <div className="mt-2 text-xl font-semibold">{formatSignedKrwAmount(result.portfolioImpactKrw)}</div>
            <Badge className="mt-3" variant={result.portfolioImpactPercent < 0 ? 'negative' : result.portfolioImpactPercent > 0 ? 'positive' : 'neutral'}>
              {formatChange(result.portfolioImpactPercent)}
            </Badge>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">실행 모드</div>
            <div className="mt-2 text-xl font-semibold">{result.action}</div>
            <Badge className="mt-3" variant={result.scoreTone}>
              {result.label}
            </Badge>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3">
            {scenarioShockControls.map((control) => {
              const current = indicatorMap.get(control.symbol)
              const factor = result.factors.find((item) => item.symbol === control.symbol)
              const contribution = factor ? Math.abs(factor.scoreImpact) / control.limit : 0

              return (
                <div key={control.symbol} className="rounded-md border border-border bg-muted/10 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{control.symbol}</span>
                        <span className="text-sm font-medium">{control.label}</span>
                        <Badge variant={factor?.tone ?? 'neutral'}>{formatChange(shocks[control.symbol])}</Badge>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-muted-foreground">
                        현재 {current ? formatChange(current.change) : '수집 대기'} · {control.note}
                      </div>
                    </div>
                    <Badge variant={factor?.tone ?? 'neutral'}>
                      {factor && factor.scoreImpact > 0 ? '+' : ''}
                      {factor?.scoreImpact ?? 0}점
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_104px]">
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={shocks[control.symbol]}
                      aria-label={control.label}
                      onChange={(event) => updateShock(control.symbol, event.target.value)}
                      className="h-2 w-full cursor-pointer accent-primary"
                    />
                    <input
                      type="number"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={shocks[control.symbol]}
                      aria-label={`${control.label} 숫자 입력`}
                      onChange={(event) => updateShock(control.symbol, event.target.value)}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-right font-mono text-sm text-foreground outline-none transition focus:border-primary"
                    />
                  </div>
                  <Progress className="mt-3" value={clamp(contribution * 100, 0, 100)} />
                </div>
              )
            })}
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">점수 기여도</div>
              <div className="mt-3 grid gap-2">
                {result.factors.map((factor) => (
                  <div key={factor.symbol} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold">{factor.symbol}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{factor.note}</div>
                    </div>
                    <Badge variant={factor.tone}>
                      {factor.scoreImpact > 0 ? '+' : ''}
                      {factor.scoreImpact}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">민감 포지션</div>
              <div className="mt-3 grid gap-2">
                {result.positions.slice(0, 5).map((position) => (
                  <div key={position.symbol} className="rounded-md border border-border bg-background/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{position.symbol}</span>
                          <span className="text-sm font-medium">{position.name}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {position.sensitivity.slice(0, 4).map((symbol) => (
                            <Badge key={symbol} variant="secondary">
                              {symbol}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge variant={position.tone}>{formatChange(position.impactPercent)}</Badge>
                        <div className="mt-2 text-xs text-muted-foreground">{formatSignedKrwAmount(position.impactKrw)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const koreaBridgeRiskLabel: Record<KoreaMarketBridge['riskLevel'], string> = {
  low: '낮음',
  medium: '주의',
  high: '높음',
}

const koreaBridgeRiskVariant: Record<KoreaMarketBridge['riskLevel'], 'positive' | 'negative' | 'warning'> = {
  low: 'positive',
  medium: 'warning',
  high: 'negative',
}

function KoreaMarketBridgePanel({ bridge, compact = false }: { bridge: KoreaMarketBridge; compact?: boolean }) {
  const visibleSignals = compact ? bridge.signals.slice(0, 4) : bridge.signals

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>미국 선행지표 → 국내장 브리지</CardTitle>
            <CardDescription>{bridge.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={bridge.tone}>{bridge.label}</Badge>
            <Badge variant={koreaBridgeRiskVariant[bridge.riskLevel]}>위험 {koreaBridgeRiskLabel[bridge.riskLevel]}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">브리지 점수</div>
            <div className="mt-2 text-2xl font-semibold">{bridge.score}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">장 초반 전략</div>
            <div className="mt-2 text-sm font-semibold leading-5">{bridge.openBias}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">KOSPI 예상</div>
            <div className="mt-2 font-mono text-sm font-semibold">{bridge.kospiRange}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">KOSDAQ 예상</div>
            <div className="mt-2 font-mono text-sm font-semibold">{bridge.kosdaqRange}</div>
          </div>
        </div>

        <div className={cn('grid gap-4', compact ? 'xl:grid-cols-[minmax(0,1fr)_280px]' : 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
          <div className="grid gap-2">
            {visibleSignals.map((signal) => (
              <div key={signal.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{signal.symbol}</span>
                      <span className="text-sm text-muted-foreground">{signal.name}</span>
                      <Badge variant={directionVariant(signal.direction)}>{formatChange(signal.change)}</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-5">{signal.koreanImpact}</div>
                  </div>
                  <Badge variant={signal.tone}>{signal.impact > 0 ? `+${signal.impact}` : signal.impact}</Badge>
                </div>
                {!compact ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{signal.confirmation}</div> : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {signal.relatedSymbols.slice(0, compact ? 4 : 6).map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">개장 전 체크</div>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                {bridge.playbook.map((item) => (
                  <div key={item} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">우선 확인 심볼</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {bridge.watchSymbols.map((symbol) => (
                  <Badge key={symbol} variant="neutral">
                    {symbol}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const newsImpactBoardStatusLabel: Record<NewsImpactBoard['status'], string> = {
  live: '실시간 뉴스',
  fallback: '샘플 이슈',
  empty: '대기',
}

const newsImpactSourceLabel: Record<NewsImpactBoard['items'][number]['source'], string> = {
  holding: '보유',
  watchlist: '관심',
}

function NewsImpactBoardPanel({ board, compact = false }: { board: NewsImpactBoard; compact?: boolean }) {
  const visibleItems = compact ? board.items.slice(0, 4) : board.items
  const topSymbolText = board.hotSymbols.length > 0 ? board.hotSymbols.join(', ') : '확인 대기'

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>종목별 이슈 영향판</CardTitle>
            <CardDescription>{board.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={board.status === 'live' ? 'positive' : board.status === 'fallback' ? 'warning' : 'neutral'}>{newsImpactBoardStatusLabel[board.status]}</Badge>
            <Badge variant="secondary">{formatNewsTime(board.generatedAt)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">영향 종목</div>
            <div className="mt-2 text-2xl font-semibold">{board.items.length}개</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">연결 뉴스</div>
            <div className="mt-2 text-2xl font-semibold">{board.totalLinkedNews}건</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">상승 / 부담 / 혼재</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="positive">{board.positiveCount}</Badge>
              <Badge variant="negative">{board.negativeCount}</Badge>
              <Badge variant="warning">{board.mixedCount}</Badge>
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">집중 심볼</div>
            <div className="mt-2 text-sm font-semibold leading-5">{topSymbolText}</div>
          </div>
        </div>

        {visibleItems.length > 0 ? (
          <div className="grid gap-3">
            {visibleItems.map((item) => (
              <div key={`${item.source}-${item.symbol}`} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{item.symbol}</span>
                      <span className="text-sm font-medium">{item.name}</span>
                      <Badge variant="secondary">{newsImpactSourceLabel[item.source]}</Badge>
                      <Badge variant={item.tone}>{item.score > 0 ? `+${item.score}` : item.score}</Badge>
                    </div>
                    <div className="mt-2 text-sm font-medium leading-5">{item.topHeadline}</div>
                    <div className="mt-2 text-sm leading-5 text-muted-foreground">{item.expectedMove}</div>
                    {!compact ? <div className="mt-2 text-sm leading-5">{item.suggestedAction}</div> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-48 lg:justify-end">
                    <Badge variant="neutral">{item.issueCount}건</Badge>
                    <Badge variant="positive">상승 {item.positiveCount}</Badge>
                    <Badge variant="negative">부담 {item.negativeCount}</Badge>
                    {item.highImportanceCount > 0 ? <Badge variant="warning">중요 {item.highImportanceCount}</Badge> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.catalysts.slice(0, compact ? 4 : 6).map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                  <Badge variant="neutral">{formatNewsTime(item.latestAt)}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/10 p-4 text-sm leading-6 text-muted-foreground">
            보유종목이나 관심종목과 연결된 뉴스가 아직 없습니다. 뉴스 키워드에 종목명이나 섹터 키워드를 추가하면 이 영역에 바로 반영됩니다.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CatalystRadarPanel({ radar, compact = false }: { radar: CatalystRadar; compact?: boolean }) {
  const visibleBuckets = compact ? (['now', 'today', 'overnight'] as CatalystBucket[]) : (['now', 'today', 'overnight', 'upcoming'] as CatalystBucket[])
  const visibleItems = compact ? radar.items.slice(0, 5) : radar.items

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>촉매 레이더</CardTitle>
            <CardDescription>{radar.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={radar.urgentCount > 0 ? 'warning' : 'neutral'}>{radar.urgentCount}개 즉시/오늘</Badge>
            <Badge variant="secondary">{formatNewsTime(radar.generatedAt)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">전체 촉매</div>
            <div className="mt-2 text-2xl font-semibold">{radar.totalCount}개</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">고중요</div>
            <div className="mt-2 text-2xl font-semibold">{radar.highImportanceCount}개</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">주요 소스</div>
            <div className="mt-2 text-lg font-semibold">{radar.topSource === 'none' ? '대기' : catalystSourceLabel[radar.topSource]}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">연결 심볼</div>
            <div className="mt-2 text-sm font-semibold leading-5">{radar.topSymbols.length > 0 ? radar.topSymbols.slice(0, 4).join(', ') : '확인 대기'}</div>
          </div>
        </div>

        <div
          className={cn(
            'grid min-w-0 gap-4',
            compact ? '2xl:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]',
          )}
        >
          <div className="grid min-w-0 gap-3">
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-muted/10 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={item.tone}>{catalystBucketLabel[item.bucket]}</Badge>
                        <Badge variant="secondary">{catalystSourceLabel[item.source]}</Badge>
                        <Badge variant={item.score >= 80 ? 'warning' : 'neutral'}>{item.score}점</Badge>
                        <span className="text-xs text-muted-foreground">{item.timeLabel}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold leading-5">{item.title}</div>
                      <div className="mt-2 text-sm leading-5 text-muted-foreground">{item.summary}</div>
                      {!compact ? <div className="mt-2 text-sm leading-5">{item.action}</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 lg:max-w-44 lg:justify-end">
                      {item.relatedSymbols.slice(0, compact ? 3 : 5).map((symbol) => (
                        <Badge key={symbol} variant="secondary">
                          {symbol}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-border bg-muted/10 p-4 text-sm leading-6 text-muted-foreground">
                확인된 촉매가 없습니다. 뉴스, 공시, 캘린더를 새로고침하면 이 영역에 시간순으로 정리됩니다.
              </div>
            )}
          </div>

          <div className="grid min-w-0 content-start gap-3">
            {visibleBuckets.map((bucket) => (
              <div key={bucket} className="min-w-0 rounded-md border border-border bg-muted/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-muted-foreground">{catalystBucketLabel[bucket]}</div>
                  <Badge variant={radar.buckets[bucket].length > 0 ? 'warning' : 'neutral'}>{radar.buckets[bucket].length}개</Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {radar.buckets[bucket].slice(0, compact ? 2 : 3).map((item) => (
                    <div key={`${bucket}-${item.id}`} className="min-w-0 rounded-md border border-border bg-background/70 px-3 py-2">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                        <Badge variant={item.tone}>{item.score}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.action}</div>
                    </div>
                  ))}
                  {radar.buckets[bucket].length === 0 ? <div className="text-xs text-muted-foreground">대기 중</div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MarketPulseRailPanel({ pulse, compact = false }: { pulse: MarketPulseRail; compact?: boolean }) {
  const visibleItems = compact ? pulse.items.slice(0, 6) : pulse.items.slice(0, 12)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>시장 충격 레일</CardTitle>
            <CardDescription>{pulse.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={pulse.tone}>순충격 {pulse.netScore > 0 ? `+${pulse.netScore}` : pulse.netScore}</Badge>
            <Badge variant={pulse.urgentCount > 0 ? 'warning' : 'secondary'}>즉시 확인 {pulse.urgentCount}개</Badge>
            <Badge variant="secondary">{formatNewsTime(pulse.generatedAt)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-positive/25 bg-positive/10 p-3">
            <div className="text-xs text-muted-foreground">기회 지수</div>
            <div className="mt-2 text-2xl font-semibold">{pulse.opportunityScore}</div>
            <Progress className="mt-3" value={pulse.opportunityScore} />
          </div>
          <div className="rounded-md border border-negative/25 bg-negative/10 p-3">
            <div className="text-xs text-muted-foreground">압박 지수</div>
            <div className="mt-2 text-2xl font-semibold">{pulse.pressureScore}</div>
            <Progress className="mt-3" value={pulse.pressureScore} />
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">추적 이벤트</div>
            <div className="mt-2 text-2xl font-semibold">{pulse.items.length}개</div>
            <div className="mt-2 text-xs text-muted-foreground">지표·뉴스·공시·일정·알림 합산</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">집중 심볼</div>
            <div className="mt-2 text-sm font-semibold leading-5">{pulse.topSymbols.length > 0 ? pulse.topSymbols.slice(0, 5).join(', ') : '확인 대기'}</div>
          </div>
        </div>

        <div className={cn('grid gap-4', compact ? '2xl:grid-cols-[minmax(0,1fr)_280px]' : 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
          <div className="grid min-w-0 gap-3">
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-muted/10 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={item.tone}>{marketPulseHorizonLabel[item.horizon]}</Badge>
                        <Badge variant="secondary">{marketPulseSourceLabel[item.source]}</Badge>
                        <Badge variant={item.impactScore >= 75 ? 'warning' : 'neutral'}>{item.impactScore}점</Badge>
                        <span className="text-xs text-muted-foreground">{item.timeLabel}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold leading-5">{item.title}</div>
                      <div className="mt-2 text-sm leading-5 text-muted-foreground">{item.summary}</div>
                      {!compact ? <div className="mt-2 text-sm leading-5">{item.action}</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 lg:max-w-48 lg:justify-end">
                      <Badge variant="positive">기회 {item.opportunityScore}</Badge>
                      <Badge variant="negative">압박 {item.pressureScore}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.relatedSymbols.slice(0, compact ? 4 : 6).map((symbol) => (
                      <Badge key={symbol} variant="secondary">
                        {symbol}
                      </Badge>
                    ))}
                    <Badge variant="neutral">{item.evidence}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-border bg-muted/10 p-4 text-sm leading-6 text-muted-foreground">
                아직 충격 레일에 올릴 이벤트가 없습니다. 시세, 뉴스, 공시, 캘린더를 새로고침하면 여기서 우선순위를 다시 계산합니다.
              </div>
            )}
          </div>

          <div className="grid min-w-0 content-start gap-3">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">장전 대응</div>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                {pulse.playbook.map((item) => (
                  <div key={item} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">구간별 이벤트</div>
              <div className="mt-3 grid gap-2">
                {(['now', 'preopen', 'session', 'overnight'] as MarketPulseHorizon[]).map((horizon) => {
                  const count = pulse.items.filter((item) => item.horizon === horizon).length
                  return (
                    <div key={horizon} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2 text-sm">
                      <span>{marketPulseHorizonLabel[horizon]}</span>
                      <Badge variant={count > 0 ? 'warning' : 'neutral'}>{count}개</Badge>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MarketSessionControlPanel({ session, compact = false }: { session: MarketSessionControl; compact?: boolean }) {
  const visibleTasks = compact ? session.tasks.slice(0, 4) : session.tasks

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>장중 컨트롤 타워</CardTitle>
            <CardDescription>{session.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={session.tone}>{session.phaseLabel}</Badge>
            <Badge variant="secondary">{session.kstTimeLabel}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">현재 단계</div>
            <div className="mt-2 text-lg font-semibold">{session.phaseLabel}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">대응 모드</div>
            <div className="mt-2 text-lg font-semibold">{session.tradeMode}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">다음 체크</div>
            <div className="mt-2 text-sm font-semibold leading-5">{session.nextCheckpointLabel}</div>
            <div className="mt-1 text-xs text-muted-foreground">{session.nextCheckpointTimeLabel}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">남은 시간</div>
            <div className="mt-2 text-lg font-semibold">{formatMinutesUntil(session.minutesToNext)}</div>
          </div>
        </div>

        <div className={cn('grid gap-4', compact ? '2xl:grid-cols-[minmax(0,1fr)_280px]' : 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
          <div className="grid min-w-0 gap-3">
            {visibleTasks.map((task) => (
              <div key={task.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={actionPriorityVariant(task.priority)}>{actionPriorityLabel[task.priority]}</Badge>
                      <Badge variant={task.tone}>{task.evidence}</Badge>
                    </div>
                    <div className="mt-2 text-sm font-semibold leading-5">{task.title}</div>
                    <div className="mt-2 text-sm leading-5 text-muted-foreground">{task.summary}</div>
                  </div>
                  <Clock3 className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>

          <div className="grid min-w-0 content-start gap-3">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">집중 심볼</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {session.focusSymbols.length > 0 ? (
                  session.focusSymbols.map((symbol) => (
                    <Badge key={symbol} variant="neutral">
                      {symbol}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">확인 대기</span>
                )}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <div className="text-xs font-medium text-muted-foreground">가드레일</div>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                {session.guardrails.slice(0, compact ? 3 : session.guardrails.length).map((item) => (
                  <div key={item} className="flex gap-2">
                    <X className="mt-0.5 size-4 shrink-0 text-negative" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DataReliabilityPanel({
  reliability,
  onRefreshAll,
  refreshing = false,
  compact = false,
}: {
  reliability: DataReliability
  onRefreshAll?: () => void
  refreshing?: boolean
  compact?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>실데이터 신뢰도</CardTitle>
            <CardDescription>{reliability.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={reliability.tone}>{reliability.label}</Badge>
            <Badge variant="secondary">신뢰도 {confidenceLabel[reliability.confidence]}</Badge>
            {onRefreshAll ? (
              <Button type="button" variant="outline" size="sm" onClick={onRefreshAll} disabled={refreshing}>
                <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
                전체 새로고침
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-muted/15 p-4">
            <div className="mb-2 text-xs text-muted-foreground">현재 계산 신뢰도</div>
            <div className="flex items-end gap-2">
              <div className="text-4xl font-semibold leading-none">{reliability.score}</div>
              <div className="pb-1 text-sm text-muted-foreground">/ 100</div>
            </div>
            <Progress className="mt-4" value={reliability.score} />
            <div className="mt-3 text-xs leading-5 text-muted-foreground">
              시세, 뉴스, 공시, 캘린더의 연결 상태를 가중 평균했습니다.
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {reliability.sources.map((source) => (
              <div key={source.id} className="rounded-md border border-border bg-muted/15 p-3">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{source.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">가중치 {source.weight}%</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge variant={source.tone}>{source.modeLabel}</Badge>
                    <Badge variant="secondary">{source.statusLabel}</Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="secondary">{source.metric}</Badge>
                  <span className="text-sm font-semibold">{source.score}점</span>
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">{compact ? source.effect : source.summary}</div>
                {!compact ? (
                  <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                    <div>
                      <span className="text-foreground/80">경로</span> · {source.endpoint}
                    </div>
                    <div>
                      <span className="text-foreground/80">설정</span> · {source.requiredConfig}
                    </div>
                    <div>
                      <span className="text-foreground/80">다음 조치</span> · {source.nextAction}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-2 text-sm font-semibold">예측에 반영되는 방식</div>
            <div className="space-y-2">
              {reliability.sources.slice(0, compact ? 2 : 4).map((source) => (
                <div key={source.id} className="text-sm leading-6 text-muted-foreground">
                  {source.effect}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-2 text-sm font-semibold">다음 확인 액션</div>
            <div className="space-y-2">
              {reliability.nextActions.map((action) => (
                <div key={action} className="text-sm leading-6 text-muted-foreground">
                  {action}
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DataFreshnessPanel({
  freshness,
  onRefreshAll,
  refreshing = false,
  compact = false,
}: {
  freshness: DataFreshness
  onRefreshAll?: () => void
  refreshing?: boolean
  compact?: boolean
}) {
  const visibleSources = compact ? freshness.sources.slice(0, 4) : freshness.sources

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>데이터 최신성 가드</CardTitle>
            <CardDescription>{freshness.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={freshness.tone}>{freshness.label}</Badge>
            <Badge variant="secondary">다음 확인 {freshness.nextRefreshLabel}</Badge>
            {onRefreshAll ? (
              <Button type="button" variant="outline" size="sm" onClick={onRefreshAll} disabled={refreshing}>
                <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
                전체 새로고침
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">최신성 점수</div>
            <div className="mt-2 text-2xl font-semibold">{freshness.score}/100</div>
            <Progress className="mt-3" value={freshness.score} />
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">갱신 필요</div>
            <div className="mt-2 text-2xl font-semibold">{freshness.staleCount}개</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">수신 전</div>
            <div className="mt-2 text-2xl font-semibold">{freshness.missingCount}개</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">검사 시각</div>
            <div className="mt-2 text-sm font-semibold leading-5">{formatNewsTime(freshness.generatedAt)}</div>
          </div>
        </div>

        <div className={cn('grid gap-3', compact ? 'md:grid-cols-2 xl:grid-cols-4' : 'lg:grid-cols-2')}>
          {visibleSources.map((source) => (
            <div key={source.id} className="rounded-md border border-border bg-muted/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{source.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{source.cadenceLabel}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Badge variant={source.tone}>{source.statusLabel}</Badge>
                  <Badge variant="secondary">{source.modeLabel}</Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="neutral">{source.ageLabel}</Badge>
                <Badge variant="secondary">기준 {source.staleAfterMinutes}분</Badge>
              </div>
              <div className="mt-3 text-xs leading-5 text-muted-foreground">{compact ? source.summary : source.nextAction}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SignalAuditPanel({
  audit,
  compact = false,
}: {
  audit: SignalAudit
  compact?: boolean
}) {
  const visibleSources = compact ? audit.sources.slice(0, 4) : audit.sources
  const visibleFocus = audit.focusList.slice(0, compact ? 3 : 5)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>예측 근거 감사</CardTitle>
            <CardDescription>{audit.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={directionVariant(audit.dominantDirection)}>순영향 {signedImpactLabel(audit.netImpact)}</Badge>
            <Badge variant="positive">상방 +{audit.totalPositiveImpact}</Badge>
            <Badge variant="negative">하방 -{audit.totalNegativeImpact}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-5">
          {visibleSources.map((source) => (
            <div key={source.id} className="rounded-md border border-border bg-muted/15 p-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{source.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{source.itemCount}개 근거</div>
                </div>
                <Badge variant={source.tone}>{signedImpactLabel(source.impactSum)}</Badge>
              </div>
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>기여도 {source.contributionPct}%</span>
                <span>{confidenceLabel[source.confidence]}</span>
              </div>
              <Progress value={source.contributionPct} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant={source.reliabilityScore >= 64 ? 'positive' : source.reliabilityScore >= 45 ? 'warning' : 'negative'}>
                  {source.reliabilityLabel}
                </Badge>
                <Badge variant="secondary">{source.reliabilityScore}점</Badge>
              </div>
              {!compact ? <div className="mt-3 text-xs leading-5 text-muted-foreground">{source.summary}</div> : null}
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-3 text-sm font-semibold">먼저 확인할 근거</div>
            <div className="space-y-2">
              {visibleFocus.map((item) => (
                <div key={item} className="text-sm leading-6 text-muted-foreground">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-3 text-sm font-semibold">품질 경고</div>
            <div className="space-y-2">
              {audit.warnings.slice(0, compact ? 2 : 4).map((warning) => (
                <div key={warning} className="text-sm leading-6 text-muted-foreground">
                  {warning}
                </div>
              ))}
            </div>
          </div>
        </div>

        {!compact ? (
          <div className="grid gap-3 md:grid-cols-2">
            {audit.sources
              .flatMap((source) => source.topEvidence.map((evidence) => ({ source: source.label, evidence, tone: source.tone })))
              .slice(0, 6)
              .map((item) => (
                <div key={`${item.source}-${item.evidence}`} className="rounded-md border border-border bg-muted/15 p-3">
                  <Badge variant={item.tone}>{item.source}</Badge>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.evidence}</div>
                </div>
              ))}
          </div>
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

function MorningBriefPanel({ brief, compact = false }: { brief: MorningBrief; compact?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const stanceTone: 'positive' | 'negative' | 'warning' | 'neutral' =
    brief.stance === 'risk-on' ? 'positive' : brief.stance === 'defensive' ? 'warning' : 'neutral'
  const visibleSections = brief.sections

  function copyBriefFallback(text: string) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)
    const copied = document.execCommand('copy')
    textArea.remove()
    if (!copied) throw new Error('fallback copy failed')
  }

  async function copyBrief() {
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(brief.copyText)
      } catch {
        copyBriefFallback(brief.copyText)
      }
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 2400)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{brief.title}</CardTitle>
            <CardDescription>{brief.headline}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={stanceTone}>{brief.keyMetric}</Badge>
            <Badge variant="secondary">신뢰도 {confidenceLabel[brief.confidence]}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyBrief()}>
              {copyState === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copyState === 'copied' ? '복사됨' : copyState === 'error' ? '복사 실패' : '복사'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-4">
          {visibleSections.map((section) => (
            <div key={section.id} className="rounded-md border border-border bg-muted/15 p-4">
              <div className="mb-3 text-sm font-semibold">{section.title}</div>
              <div className="space-y-2">
                {section.items.slice(0, compact ? 3 : 5).map((item) => (
                  <div key={item} className="text-sm leading-6 text-muted-foreground">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {brief.topSymbols.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {brief.topSymbols.map((symbol) => (
              <Badge key={symbol} variant="secondary">
                {symbol}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ForecastReviewPanel({
  review,
  onApplyReview,
}: {
  review: ForecastReview
  onApplyReview?: () => void
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  function copyReviewFallback(text: string) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)
    const copied = document.execCommand('copy')
    textArea.remove()
    if (!copied) throw new Error('fallback copy failed')
  }

  async function copyReview() {
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(review.reviewDraft)
      } catch {
        copyReviewFallback(review.reviewDraft)
      }
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 2400)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>예측 검증 리포트</CardTitle>
            <CardDescription>{review.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={review.tone}>{review.label}</Badge>
            <Badge variant="secondary">{review.score}/100</Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyReview()}>
              {copyState === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copyState === 'copied' ? '복사됨' : copyState === 'error' ? '복사 실패' : '초안 복사'}
            </Button>
            {onApplyReview ? (
              <Button type="button" size="sm" onClick={onApplyReview}>
                <Save className="size-4" />
                장후 리뷰에 적용
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {review.signals.map((signal) => (
            <div key={signal.id} className="rounded-md border border-border bg-muted/15 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="text-sm font-semibold">{signal.label}</div>
                <Badge variant={signal.tone}>{signal.value}</Badge>
              </div>
              <div className="text-xs leading-5 text-muted-foreground">{signal.summary}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-2 text-sm font-semibold">장후 리뷰 초안</div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-muted-foreground">{review.reviewDraft}</pre>
          </div>
          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-2 text-sm font-semibold">내일 개선 질문</div>
            <div className="space-y-2">
              {review.nextQuestions.map((question) => (
                <div key={question} className="text-sm leading-6 text-muted-foreground">
                  {question}
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ForecastCalibrationPanel({ calibration, compact = false }: { calibration: ForecastCalibration; compact?: boolean }) {
  const recentItems = compact ? calibration.recent.slice(0, 3) : calibration.recent
  const focusItems = compact ? calibration.nextFocus.slice(0, 3) : calibration.nextFocus
  const metrics = [
    {
      label: '평균 검증 점수',
      value: `${calibration.averageScore}/100`,
      progress: calibration.averageScore,
      tone: calibrationTone(calibration.averageScore),
      detail: calibration.sampleCount > 0 ? `최근 ${calibration.sampleCount}개` : '현재 리포트 기준',
    },
    {
      label: '예측 적중률',
      value: `${calibration.hitRate}%`,
      progress: calibration.hitRate,
      tone: calibration.hitRate >= 70 ? 'positive' : calibration.hitRate >= 45 ? 'warning' : 'negative',
      detail: '62점 이상 비율',
    },
    {
      label: '액션 실행률',
      value: `${calibration.actionCompletionRate}%`,
      progress: calibration.actionCompletionRate,
      tone: calibration.actionCompletionRate >= 70 ? 'positive' : calibration.actionCompletionRate >= 45 ? 'warning' : 'negative',
      detail: '체크리스트 완료',
    },
    {
      label: '오늘 검증',
      value: `${calibration.currentScore}/100`,
      progress: calibration.currentScore,
      tone: calibration.tone,
      detail: calibration.currentLabel,
    },
  ] satisfies Array<{
    label: string
    value: string
    progress: number
    tone: 'positive' | 'negative' | 'warning' | 'neutral'
    detail: string
  }>

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>예측 캘리브레이션</CardTitle>
            <CardDescription>{calibration.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={calibration.tone}>{calibration.label}</Badge>
            <Badge variant="secondary">{formatNewsTime(calibration.generatedAt)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-md border border-border bg-muted/15 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                  <div className="mt-2 text-xl font-semibold">{metric.value}</div>
                </div>
                <Badge variant={metric.tone}>{metric.detail}</Badge>
              </div>
              <Progress className="mt-3" value={metric.progress} />
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-md border border-border bg-background/70 p-4">
            <div className="mb-3 text-sm font-semibold">최근 복기 표본</div>
            {recentItems.length > 0 ? (
              <div className="space-y-3">
                {recentItems.map((item) => (
                  <div key={item.id} className="rounded-md border border-border bg-muted/15 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{item.dateLabel}</Badge>
                      <Badge variant={item.tone}>{item.forecastLabel}</Badge>
                      <Badge variant={item.executionRate >= 70 ? 'positive' : item.executionRate >= 45 ? 'warning' : 'negative'}>
                        실행 {item.executionRate}%
                      </Badge>
                    </div>
                    <div className="text-sm font-semibold">{item.forecastScore}/100</div>
                    {!compact ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.summary}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
                오늘 기록 보관을 누르면 복기 표본이 쌓이고, 이후 평균 점수와 실행률이 자동으로 계산됩니다.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/70 p-4">
              <div className="mb-2 text-sm font-semibold">이번 주 보정 포인트</div>
              <div className="text-sm leading-6 text-muted-foreground">{calibration.lesson}</div>
            </div>
            <div className="rounded-md border border-border bg-background/70 p-4">
              <div className="mb-3 text-sm font-semibold">다음 집중</div>
              <div className="space-y-2">
                {focusItems.map((item) => (
                  <div key={item} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                    <Check className="mt-1 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ExecutionPlanPanel({ plan, compact = false }: { plan: ExecutionPlan; compact?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const visibleItems = compact ? plan.items.slice(0, 4) : plan.items
  const stanceTone: 'positive' | 'negative' | 'warning' | 'neutral' =
    plan.stance === 'risk-on' ? 'positive' : plan.stance === 'defensive' ? 'warning' : 'neutral'

  function copyExecutionFallback(text: string) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)
    const copied = document.execCommand('copy')
    textArea.remove()
    if (!copied) throw new Error('fallback copy failed')
  }

  async function copyExecutionPlan() {
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(plan.copyText)
      } catch {
        copyExecutionFallback(plan.copyText)
      }
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 2400)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>내일 실행 계획</CardTitle>
            <CardDescription>{plan.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={stanceTone}>{plan.stanceLabel}</Badge>
            <Badge variant={plan.netExposureKrw > 0 ? 'positive' : plan.netExposureKrw < 0 ? 'warning' : 'neutral'}>
              순노출 {formatKrwAmount(plan.netExposureKrw)}원
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyExecutionPlan()}>
              {copyState === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copyState === 'copied' ? '복사됨' : copyState === 'error' ? '복사 실패' : '계획 복사'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">신규 한도</div>
            <div className="mt-2 text-lg font-semibold">{formatKrwAmount(plan.maxNewCapitalKrw)}원</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">계획 매수</div>
            <div className="mt-2 text-lg font-semibold text-positive">{formatKrwAmount(plan.plannedBuyKrw)}원</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">축소 감시</div>
            <div className="mt-2 text-lg font-semibold text-warning">{formatKrwAmount(plan.plannedTrimKrw)}원</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">리스크 예산</div>
            <div className="mt-2 text-lg font-semibold">{formatKrwAmount(plan.riskBudgetKrw)}원</div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleItems.map((item) => (
              <div key={item.id} className="rounded-md border border-border bg-muted/15 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant={executionSideVariant(item.side)}>{executionSideLabel(item.side)}</Badge>
                  <Badge variant={playbookPriorityVariant(item.priority)}>{actionPriorityLabel[item.priority]}</Badge>
                  <Badge variant="secondary">{item.symbol}</Badge>
                  <Badge variant="secondary">신뢰도 {confidenceLabel[item.confidence]}</Badge>
                </div>
                <div className="text-sm font-semibold">{item.name}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md bg-background/70 p-2 text-xs text-muted-foreground">금액 {formatKrwAmount(item.budgetKrw)}원</div>
                  <div className="rounded-md bg-background/70 p-2 text-xs text-muted-foreground">{item.quantityGuide}</div>
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">가격대 {item.priceBand}</div>
                <div className="mt-2 text-xs leading-5 text-foreground/85">{item.trigger}</div>
                {!compact ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.riskRule}</div> : null}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold">실행 가드레일</div>
            {plan.guardrails.slice(0, compact ? 4 : 6).map((guardrail, index) => (
              <div key={guardrail} className="flex gap-3 rounded-md border border-border bg-background/70 p-3">
                <Badge variant={index === 0 ? 'warning' : 'secondary'}>{index + 1}</Badge>
                <div className="text-sm leading-6 text-muted-foreground">{guardrail}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PortfolioPlaybookPanel({ playbook, compact = false }: { playbook: PortfolioPlaybook; compact?: boolean }) {
  const topRisk = playbook.riskSignals[0]
  const stanceTone: 'positive' | 'negative' | 'warning' | 'neutral' =
    playbook.stance === 'risk-on' ? 'positive' : playbook.stance === 'defensive' ? 'warning' : 'neutral'

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>포트폴리오 플레이북</CardTitle>
            <CardDescription>{playbook.summary}</CardDescription>
          </div>
          <Badge variant={stanceTone}>{playbook.stanceLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">평가금액</div>
            <div className="mt-2 text-lg font-semibold">{formatKrwAmount(playbook.totalValueKrw)}원</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">오늘 추정 손익</div>
            <div className={cn('mt-2 text-lg font-semibold', playbook.dayPnlKrw >= 0 ? 'text-positive' : 'text-negative')}>
              {formatKrwAmount(playbook.dayPnlKrw)}원
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{formatChange(playbook.dayPnlPercent)}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">집중도</div>
            <div className="mt-2 text-lg font-semibold">{playbook.concentrationScore}/100</div>
            <Progress className="mt-2" value={playbook.concentrationScore} />
          </div>
          <div className="rounded-md border border-border bg-muted/15 p-3">
            <div className="text-xs text-muted-foreground">최대 노출</div>
            <div className="mt-2 text-lg font-semibold">{playbook.topExposureLabel}</div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="space-y-3">
            <div className="text-sm font-semibold">노출 지도</div>
            <div className="grid gap-3 md:grid-cols-2">
              {playbook.exposures.slice(0, compact ? 4 : 6).map((exposure) => (
                <div key={exposure.id} className="rounded-md border border-border bg-muted/15 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{exposure.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatKrwAmount(exposure.value)}원</div>
                    </div>
                    <Badge variant={exposure.tone}>{exposure.percent}%</Badge>
                  </div>
                  <Progress value={exposure.percent} />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {exposure.symbols.slice(0, 4).map((symbol) => (
                      <Badge key={symbol} variant="secondary">
                        {symbol}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{exposure.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold">리스크 신호</div>
            {playbook.riskSignals.slice(0, compact ? 3 : 5).map((signal) => (
              <div key={signal.id} className="rounded-md border border-border bg-muted/15 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={portfolioVariantFromSeverity(signal.severity)}>{portfolioSeverityLabel[signal.severity]}</Badge>
                  {signal.relatedSymbols.slice(0, 3).map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm font-semibold">{signal.title}</div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{signal.summary}</div>
                {!compact ? <div className="mt-2 text-xs leading-5 text-foreground/80">{signal.suggestedAction}</div> : null}
              </div>
            ))}
          </div>
        </div>

        {!compact ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-3">
              <div className="text-sm font-semibold">종목별 행동</div>
              <div className="grid gap-3 lg:grid-cols-2">
                {playbook.positionPlans.map((item) => (
                  <div key={item.id} className="rounded-md border border-border bg-muted/15 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={positionActionVariant(item.action)}>{positionActionLabel[item.action]}</Badge>
                      <Badge variant={playbookPriorityVariant(item.priority)}>{actionPriorityLabel[item.priority]}</Badge>
                      <Badge variant="secondary">{item.symbol}</Badge>
                    </div>
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</div>
                    <div className="mt-2 text-xs leading-5 text-foreground/80">{item.trigger}</div>
                    <div className="mt-2 rounded-md bg-background/70 p-2 text-xs text-muted-foreground">{item.priceGuide}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold">장전 순서</div>
              {playbook.preMarketSteps.map((step, index) => (
                <div key={step} className="flex gap-3 rounded-md border border-border bg-muted/15 p-3">
                  <Badge variant={index === 0 ? 'warning' : 'secondary'}>{index + 1}</Badge>
                  <div className="text-sm leading-6">{step}</div>
                </div>
              ))}
              {topRisk ? (
                <div className="rounded-md border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-foreground/85">
                  핵심 확인: {topRisk.evidence}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
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
  koreaMarketBridge,
  marketPulse,
}: {
  leadingIndicatorsData: MarketIndicator[]
  biasScoreData: BiasScore
  koreaMarketBridge: KoreaMarketBridge
  marketPulse: MarketPulseRail
}) {
  const indicatorChartData = buildIndicatorChartData(leadingIndicatorsData)

  return (
    <PageGrid>
      <KoreaMarketBridgePanel bridge={koreaMarketBridge} />

      <MarketPulseRailPanel pulse={marketPulse} />

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

function ForecastPage({
  forecast,
  holdingsData,
  leadingIndicatorsData,
  newsImpactBoard,
  catalystRadar,
  marketPulse,
  actionQueue,
  portfolioPlaybook,
  dataReliability,
  dataFreshness,
  signalAudit,
  forecastSensitivity,
  overnightStressTest,
  preMarketCommand,
  marketSession,
  executionPlan,
  usdKrw,
}: {
  forecast: MarketForecast
  holdingsData: Holding[]
  leadingIndicatorsData: MarketIndicator[]
  newsImpactBoard: NewsImpactBoard
  catalystRadar: CatalystRadar
  marketPulse: MarketPulseRail
  actionQueue: ActionQueueItem[]
  portfolioPlaybook: PortfolioPlaybook
  dataReliability: DataReliability
  dataFreshness: DataFreshness
  signalAudit: SignalAudit
  forecastSensitivity: ForecastSensitivity
  overnightStressTest: OvernightStressTest
  preMarketCommand: PreMarketCommandCenter
  marketSession: MarketSessionControl
  executionPlan: ExecutionPlan
  usdKrw: number
}) {
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

      <PreMarketCommandCenterPanel command={preMarketCommand} />

      <MarketSessionControlPanel session={marketSession} compact />

      <MarketPulseRailPanel pulse={marketPulse} compact />

      <DataReliabilityPanel reliability={dataReliability} compact />

      <DataFreshnessPanel freshness={dataFreshness} compact />

      <SignalAuditPanel audit={signalAudit} />

      <ForecastSensitivityPanel sensitivity={forecastSensitivity} />

      <CatalystRadarPanel radar={catalystRadar} />

      <ScenarioSimulatorPanel forecast={forecast} holdingsData={holdingsData} indicators={leadingIndicatorsData} newsImpactBoard={newsImpactBoard} usdKrw={usdKrw} />

      <OvernightStressTestPanel stress={overnightStressTest} />

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

      <PortfolioPlaybookPanel playbook={portfolioPlaybook} />

      <ExecutionPlanPanel plan={executionPlan} />

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
  newsKeywordsData,
  liveNews,
  newsStatus,
  newsMessage,
  newsImpactBoard,
  onRefreshNews,
}: {
  holdingsData: Holding[]
  newsKeywordsData: string[]
  liveNews: LiveNewsItem[]
  newsStatus: NewsStatus
  newsMessage: string
  newsImpactBoard: NewsImpactBoard
  onRefreshNews: () => void
}) {
  const [activeKeyword, setActiveKeyword] = useState('전체')

  const keywordFilters = ['전체', ...newsKeywordsData]
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

      <NewsImpactBoardPanel board={newsImpactBoard} />

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

type CalendarEventFormState = {
  id: string | null
  absoluteDate: string
  time: string
  title: string
  type: CalendarEvent['type']
  importance: CalendarEvent['importance']
  status: NonNullable<CalendarEvent['status']>
  relatedSymbols: string
  description: string
}

function createEmptyCalendarEventForm(): CalendarEventFormState {
  return {
    id: null,
    absoluteDate: getKstDateKey(),
    time: '09:00',
    title: '',
    type: 'company',
    importance: 'medium',
    status: 'watch',
    relatedSymbols: '',
    description: '',
  }
}

function calendarEventToForm(event: CalendarEvent): CalendarEventFormState {
  return {
    id: event.id,
    absoluteDate: event.absoluteDate ?? getKstDateKey(),
    time: event.time,
    title: event.title,
    type: event.type,
    importance: event.importance,
    status: normalizeCalendarEventStatus(event.status),
    relatedSymbols: event.relatedSymbols.join(', '),
    description: event.description ?? '',
  }
}

function formToCalendarEvent(form: CalendarEventFormState, existing?: CalendarEvent): CalendarEvent {
  const absoluteDate = parseDateKey(form.absoluteDate) ? form.absoluteDate : getKstDateKey()
  const title = normalizeNewsKeyword(form.title) || '개인 이벤트'
  const time = /^\d{2}:\d{2}$/.test(form.time) ? form.time : '09:00'
  const relatedSymbols = form.relatedSymbols
    .split(',')
    .map(normalizeUserSymbol)
    .filter(Boolean)
    .slice(0, 8)

  return {
    id: existing?.id ?? form.id ?? `user-calendar-${Date.now()}`,
    date: formatCalendarDateLabel(absoluteDate),
    absoluteDate,
    time,
    title,
    type: form.type,
    importance: form.importance,
    relatedSymbols,
    status: form.status,
    confidence: 'medium',
    source: '개인 캘린더',
    description: normalizeNewsKeyword(form.description),
  }
}

function isPersonalCalendarEvent(event: CalendarEvent) {
  return event.source === '개인 캘린더' || event.id.startsWith('user-calendar-')
}

function CalendarPage({
  eventsData,
  personalEvents,
  calendarStatus,
  calendarMessage,
  onRefreshCalendar,
  onSaveCalendarEvent,
  onDeleteCalendarEvent,
  onResetCalendarEvents,
}: {
  eventsData: CalendarEvent[]
  personalEvents: CalendarEvent[]
  calendarStatus: CalendarStatus
  calendarMessage: string
  onRefreshCalendar: () => void
  onSaveCalendarEvent: (event: CalendarEvent, previousId?: string) => void
  onDeleteCalendarEvent: (id: string) => void
  onResetCalendarEvents: () => void
}) {
  const [form, setForm] = useState<CalendarEventFormState>(() => createEmptyCalendarEventForm())
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

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>이벤트 타임라인</CardTitle>
                <CardDescription>자동 수집 일정과 개인 일정을 함께 표시</CardDescription>
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
            <Badge variant="secondary">개인 일정 {personalEvents.length}개</Badge>
            <span className="text-xs text-muted-foreground">{calendarMessage}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
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
                {isPersonalCalendarEvent(event) ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setForm(calendarEventToForm(event))}>
                      <Pencil className="size-4" />
                      수정
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="text-negative hover:text-negative" onClick={() => onDeleteCalendarEvent(event.id)}>
                      <Trash2 className="size-4" />
                      삭제
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{form.id ? '개인 일정 수정' : '개인 일정 추가'}</CardTitle>
            <CardDescription>실적, FOMC, 환율 이벤트, 종목 메모를 직접 등록</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                const existing = form.id ? personalEvents.find((item) => item.id === form.id) : undefined
                onSaveCalendarEvent(formToCalendarEvent(form, existing), form.id ?? undefined)
                setForm(createEmptyCalendarEventForm())
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">제목</span>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="예: 엔비디아 실적 발표"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">날짜</span>
                  <input
                    type="date"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={form.absoluteDate}
                    onChange={(event) => setForm((current) => ({ ...current, absoluteDate: event.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">시간</span>
                  <input
                    type="time"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={form.time}
                    onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">유형</span>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={form.type}
                    onChange={(event) => setForm((current) => ({ ...current, type: normalizeCalendarEventType(event.target.value) }))}
                  >
                    {Object.entries(calendarTypeLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">중요도</span>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={form.importance}
                    onChange={(event) => setForm((current) => ({ ...current, importance: normalizeImportance(event.target.value) }))}
                  >
                    <option value="high">높음</option>
                    <option value="medium">보통</option>
                    <option value="low">낮음</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">상태</span>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: normalizeCalendarEventStatus(event.target.value) }))}
                  >
                    {Object.entries(calendarStatusLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">관련 심볼</span>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                  value={form.relatedSymbols}
                  onChange={(event) => setForm((current) => ({ ...current, relatedSymbols: event.target.value }))}
                  placeholder="예: NVDA, SOX, NQ=F"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">메모</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="발표 전후 확인할 조건이나 포지션 메모"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">
                  <Save className="size-4" />
                  저장
                </Button>
                <Button type="button" variant="outline" onClick={() => setForm(createEmptyCalendarEventForm())}>
                  새 입력
                </Button>
                <Button type="button" variant="ghost" className="text-negative hover:text-negative" onClick={onResetCalendarEvents} disabled={personalEvents.length === 0}>
                  개인 일정 초기화
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </PageGrid>
  )
}

type AlertRuleFormState = {
  id: string | null
  name: string
  type: AlertRule['type']
  target: string
  threshold: string
}

const emptyAlertRuleForm: AlertRuleFormState = {
  id: null,
  name: '',
  type: 'price-below',
  target: '',
  threshold: '',
}

function alertRuleToForm(rule: AlertRule): AlertRuleFormState {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    target: rule.target,
    threshold: String(rule.threshold),
  }
}

function formToAlertRule(form: AlertRuleFormState, existing?: AlertRule): AlertRule {
  const type = form.type
  const target = type === 'bias-above' || type === 'bias-below' ? 'KOSPI' : normalizeNewsKeyword(form.target)
  const threshold = type === 'news-keyword' ? 0 : parseNumericInput(form.threshold)
  const name = normalizeNewsKeyword(form.name) || `${target} ${alertRuleTypeLabel[type]}`

  return {
    id: existing?.id ?? `alert-${Date.now()}`,
    name,
    type,
    target,
    threshold,
    enabled: existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
}

function AlertsPage({
  actionQueue,
  alertRules,
  alertSettings,
  alertHistory,
  notificationPermission,
  triggeredAlerts,
  onSaveAlertRule,
  onDeleteAlertRule,
  onToggleAlertRule,
  onResetAlertRules,
  onUpdateAlertSettings,
  onRequestBrowserNotifications,
  onMarkAlertHistoryRead,
  onClearAlertHistory,
}: {
  actionQueue: ActionQueueItem[]
  alertRules: AlertRule[]
  alertSettings: AlertSettings
  alertHistory: AlertHistoryItem[]
  notificationPermission: NotificationPermissionState
  triggeredAlerts: TriggeredAlert[]
  onSaveAlertRule: (rule: AlertRule, previousId?: string) => void
  onDeleteAlertRule: (id: string) => void
  onToggleAlertRule: (id: string) => void
  onResetAlertRules: () => void
  onUpdateAlertSettings: (patch: Partial<AlertSettings>) => void
  onRequestBrowserNotifications: () => Promise<void>
  onMarkAlertHistoryRead: () => void
  onClearAlertHistory: () => void
}) {
  const [form, setForm] = useState<AlertRuleFormState>(emptyAlertRuleForm)
  const criticalCount = actionQueue.filter((item) => item.priority === 'critical').length
  const highCount = actionQueue.filter((item) => item.priority === 'high').length
  const watchlistCount = actionQueue.filter((item) => item.category === 'watchlist').length
  const enabledRuleCount = alertRules.filter((rule) => rule.enabled).length
  const highTriggeredCount = triggeredAlerts.filter((item) => item.severity === 'critical' || item.severity === 'high').length
  const unreadHistoryCount = alertHistory.filter((item) => !item.read).length
  const notificationStatusLabel =
    notificationPermission === 'unsupported'
      ? '미지원'
      : notificationPermission === 'granted'
        ? alertSettings.browserNotifications
          ? '켜짐'
          : '꺼짐'
        : notificationPermission === 'denied'
          ? '차단됨'
          : '권한 필요'

  function clearForm() {
    setForm(emptyAlertRuleForm)
  }

  function editRule(rule: AlertRule) {
    setForm(alertRuleToForm(rule))
  }

  function submitRule() {
    const rule = formToAlertRule(form, alertRules.find((item) => item.id === form.id))
    if (!rule.target) return
    onSaveAlertRule(rule, form.id ?? undefined)
    clearForm()
  }

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="긴급 알림" value={`${criticalCount}개`} detail="즉시 확인" tone={criticalCount > 0 ? 'negative' : 'neutral'} />
        <MetricCard label="높은 우선순위" value={`${highCount}개`} detail="오늘 처리" tone={highCount > 0 ? 'warning' : 'neutral'} />
        <MetricCard label="관심가/트리거" value={`${watchlistCount}개`} detail="가격 조건" tone={watchlistCount > 0 ? 'positive' : 'neutral'} />
        <MetricCard label="알림 기록" value={`${unreadHistoryCount}/${alertHistory.length}`} detail={notificationStatusLabel} tone={highTriggeredCount > 0 ? 'negative' : unreadHistoryCount > 0 ? 'warning' : 'neutral'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>조건 알림</CardTitle>
            <CardDescription>활성 조건 {enabledRuleCount}개 기준으로 가격, 등락률, 뉴스, 방향점수를 확인합니다</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {triggeredAlerts.length > 0 ? (
              triggeredAlerts.map((alert) => (
                <div key={alert.id} className="rounded-md border border-border bg-muted/15 p-4">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant={actionPriorityVariant(alert.severity)}>{alertSeverityLabel[alert.severity]}</Badge>
                    {alert.relatedSymbols.map((symbol) => (
                      <Badge key={symbol} variant="secondary">
                        {symbol}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-sm font-semibold">{alert.title}</div>
                  <div className="mt-2 text-sm leading-6 text-foreground/85">{alert.summary}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{alert.evidence}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-border bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
                현재 발동된 사용자 조건은 없습니다. 장 시작 전에는 환율, VIX, NQ=F, 보유종목 가격 조건을 먼저 걸어두면 좋습니다.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>브라우저 알림</CardTitle>
              <CardDescription>조건이 새로 발동되면 기기 알림으로 표시</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={notificationPermission === 'granted' && alertSettings.browserNotifications ? 'positive' : notificationPermission === 'denied' ? 'negative' : 'warning'}>
                  {notificationStatusLabel}
                </Badge>
                <Badge variant="secondary">{alertSeverityLabel[alertSettings.minimumSeverity]} 이상</Badge>
              </div>
              <select
                className={inputClassName}
                value={alertSettings.minimumSeverity}
                onChange={(event) => onUpdateAlertSettings({ minimumSeverity: event.target.value as TriggeredAlert['severity'] })}
              >
                {(['low', 'medium', 'high', 'critical'] as const).map((severity) => (
                  <option key={severity} value={severity}>
                    {alertSeverityLabel[severity]} 이상
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {notificationPermission === 'granted' ? (
                  <Button
                    type="button"
                    variant={alertSettings.browserNotifications ? 'outline' : 'default'}
                    onClick={() => onUpdateAlertSettings({ browserNotifications: !alertSettings.browserNotifications })}
                  >
                    <Bell className="size-4" />
                    {alertSettings.browserNotifications ? '알림 끄기' : '알림 켜기'}
                  </Button>
                ) : (
                  <Button type="button" onClick={() => void onRequestBrowserNotifications()} disabled={notificationPermission === 'unsupported' || notificationPermission === 'denied'}>
                    <Bell className="size-4" />
                    권한 요청
                  </Button>
                )}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                같은 조건과 같은 근거는 한 번만 기록합니다. 브라우저 알림은 권한 허용 후 새로 발동되는 조건부터 보냅니다.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{form.id ? '알림 조건 수정' : '알림 조건 추가'}</CardTitle>
              <CardDescription>조건은 브라우저 저장, 백업, 서버 동기화에 포함됩니다</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="조건 이름"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary"
              />
              <select
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as AlertRule['type'] }))}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary"
              >
                {Object.entries(alertRuleTypeLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={form.type === 'bias-above' || form.type === 'bias-below' ? 'KOSPI' : form.target}
                onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                disabled={form.type === 'bias-above' || form.type === 'bias-below'}
                placeholder="대상: 005930, VIX, AI"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary disabled:text-muted-foreground"
              />
              {form.type !== 'news-keyword' ? (
                <input
                  value={form.threshold}
                  onChange={(event) => setForm((current) => ({ ...current, threshold: event.target.value }))}
                  placeholder={form.type.startsWith('price') ? '기준 가격' : form.type.startsWith('bias') ? '기준 점수' : '기준 등락률 %'}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary"
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={submitRule} disabled={!form.target && form.type !== 'bias-above' && form.type !== 'bias-below'}>
                  <Save className="size-4" />
                  저장
                </Button>
                <Button type="button" variant="outline" onClick={clearForm}>
                  <X className="size-4" />
                  취소
                </Button>
                <Button type="button" variant="outline" onClick={onResetAlertRules}>
                  <RefreshCw className="size-4" />
                  기본값
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>알림 히스토리</CardTitle>
              <CardDescription>조건이 실제로 발동된 시점과 근거</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onMarkAlertHistoryRead} disabled={alertHistory.length === 0}>
                전체 읽음
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-negative hover:text-negative" onClick={onClearAlertHistory} disabled={alertHistory.length === 0}>
                기록 비우기
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {alertHistory.length > 0 ? (
            alertHistory.slice(0, 8).map((item) => (
              <div key={item.dedupeKey} className="rounded-md border border-border bg-muted/15 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant={item.read ? 'neutral' : portfolioVariantFromSeverity(item.severity)}>{item.read ? '읽음' : alertSeverityLabel[item.severity]}</Badge>
                  <Badge variant={item.notificationSent ? 'positive' : 'secondary'}>{item.notificationSent ? '기기 알림' : '기록'}</Badge>
                  <Badge variant="secondary">{formatMarketTime(item.triggeredAt)}</Badge>
                  {item.relatedSymbols.slice(0, 3).map((symbol) => (
                    <Badge key={symbol} variant="secondary">
                      {symbol}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="mt-2 text-sm leading-6 text-foreground/85">{item.summary}</div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.evidence}</div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-border bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
              아직 기록된 조건 발동 내역이 없습니다. 조건이 새로 발동되면 이곳에 시간과 근거가 남습니다.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>사용자 알림 규칙</CardTitle>
          <CardDescription>조건별 활성 상태와 현재 기준</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {alertRules.map((rule) => (
            <div key={rule.id} className="rounded-md border border-border bg-muted/15 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant={rule.enabled ? 'positive' : 'neutral'}>{rule.enabled ? '활성' : '꺼짐'}</Badge>
                <Badge variant="secondary">{alertRuleTypeLabel[rule.type]}</Badge>
                <Badge variant="secondary">{rule.target}</Badge>
              </div>
              <div className="text-sm font-semibold">{rule.name}</div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {rule.type === 'news-keyword' ? '뉴스에 키워드가 포함되면 발동' : `기준값 ${formatNumber(rule.threshold)}`}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" aria-label={`${rule.name} 수정`} onClick={() => editRule(rule)}>
                  <Pencil className="size-4" />
                  수정
                </Button>
                <Button type="button" variant="outline" size="sm" aria-label={`${rule.name} ${rule.enabled ? '끄기' : '켜기'}`} onClick={() => onToggleAlertRule(rule.id)}>
                  {rule.enabled ? '끄기' : '켜기'}
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`${rule.name} 삭제`} className="text-negative hover:text-negative" onClick={() => onDeleteAlertRule(rule.id)}>
                  <Trash2 className="size-4" />
                  삭제
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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

function JournalHistoryPanel({
  history,
  canArchive,
  onArchiveJournal,
  onDeleteJournalHistory,
  onClearJournalHistory,
}: {
  history: JournalHistoryItem[]
  canArchive: boolean
  onArchiveJournal: () => void
  onDeleteJournalHistory: (id: string) => void
  onClearJournalHistory: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>복기 히스토리</CardTitle>
            <CardDescription>날짜별 장전 계획, 실행률, 예측 검증 결과 보관</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onArchiveJournal} disabled={!canArchive}>
              <Save className="size-4" />
              오늘 기록 보관
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-negative hover:text-negative" onClick={onClearJournalHistory} disabled={history.length === 0}>
              기록 비우기
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {history.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {history.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-border bg-muted/15 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{item.date.slice(5).replace('-', '.')}</Badge>
                    <Badge variant={forecastReviewTone(item.forecastScore)}>{item.forecastLabel}</Badge>
                    <Badge variant="neutral">
                      {item.completedActionCount}/{item.totalActionCount} 실행
                    </Badge>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="text-negative hover:text-negative" onClick={() => onDeleteJournalHistory(item.id)}>
                    <Trash2 className="size-4" />
                    삭제
                  </Button>
                </div>
                <div className="text-sm font-semibold leading-6">{item.forecastSummary}</div>
                {item.topActionTitle ? <div className="mt-2 text-xs leading-5 text-muted-foreground">주요 액션: {item.topActionTitle}</div> : null}
                {item.preMarketPlan ? (
                  <div className="mt-3 rounded-md border border-border bg-background/70 p-3">
                    <div className="mb-1 text-xs text-muted-foreground">장전 계획</div>
                    <div className="text-sm leading-6">{item.preMarketPlan}</div>
                  </div>
                ) : null}
                {item.afterMarketReview ? (
                  <div className="mt-3 rounded-md border border-border bg-background/70 p-3">
                    <div className="mb-1 text-xs text-muted-foreground">장후 리뷰</div>
                    <div className="text-sm leading-6">{item.afterMarketReview}</div>
                  </div>
                ) : null}
                <div className="mt-3 text-xs text-muted-foreground">보관 {formatMarketTime(item.archivedAt)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
            아직 보관된 복기 기록이 없습니다. 장후 리뷰를 작성한 뒤 오늘 기록을 보관하면 날짜별로 누적됩니다.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function NotesPage({
  actionQueue,
  journal,
  journalHistory,
  biasScoreData,
  marketStatusData,
  morningBrief,
  marketSession,
  forecastReview,
  forecastCalibration,
  executionPlan,
  onUpdateJournal,
  onToggleJournalAction,
  onResetJournal,
  onArchiveJournal,
  onDeleteJournalHistory,
  onClearJournalHistory,
}: {
  actionQueue: ActionQueueItem[]
  journal: InvestmentJournal
  journalHistory: JournalHistoryItem[]
  biasScoreData: BiasScore
  marketStatusData: MarketStatusView
  morningBrief: MorningBrief
  marketSession: MarketSessionControl
  forecastReview: ForecastReview
  forecastCalibration: ForecastCalibration
  executionPlan: ExecutionPlan
  onUpdateJournal: (patch: Partial<InvestmentJournal>) => void
  onToggleJournalAction: (actionId: string) => void
  onResetJournal: () => void
  onArchiveJournal: () => void
  onDeleteJournalHistory: (id: string) => void
  onClearJournalHistory: () => void
}) {
  const completedCount = journal.completedActionIds.filter((id) => actionQueue.some((item) => item.id === id)).length
  const canArchiveJournal = hasJournalContent(journal)

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="저널 날짜" value={journal.date.slice(5).replace('-', '.')} detail="오늘 기록" />
        <MetricCard label="액션 완료" value={`${completedCount}/${actionQueue.length}`} detail="체크리스트" tone={completedCount > 0 ? 'positive' : 'neutral'} />
        <MetricCard label="방향점수" value={`+${biasScoreData.score}`} detail={`신뢰도 ${confidenceLabel[biasScoreData.confidence]}`} tone={biasScoreData.stance === 'pressure' ? 'negative' : biasScoreData.stance === 'neutral' ? 'neutral' : 'positive'} />
        <MetricCard label="복기 기록" value={`${journalHistory.length}개`} detail={formatSavedTime(journal.lastSavedAt)} tone={journalHistory.length > 0 ? 'positive' : 'neutral'} />
      </section>

      <ActionQueuePanel
        items={actionQueue}
        title="장 시작 전 실행 순서"
        description="투자노트에 기록하기 전 먼저 볼 항목"
        maxItems={5}
        compact
      />

      <MorningBriefPanel brief={morningBrief} />

      <MarketSessionControlPanel session={marketSession} compact />

      <ForecastReviewPanel
        review={forecastReview}
        onApplyReview={() => onUpdateJournal({ afterMarketReview: forecastReview.reviewDraft })}
      />

      <ForecastCalibrationPanel calibration={forecastCalibration} />

      <ExecutionPlanPanel plan={executionPlan} />

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

      <JournalHistoryPanel
        history={journalHistory}
        canArchive={canArchiveJournal}
        onArchiveJournal={onArchiveJournal}
        onDeleteJournalHistory={onDeleteJournalHistory}
        onClearJournalHistory={onClearJournalHistory}
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
  newsKeywordsData,
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
  dataReliability,
  dataFreshness,
  backupData,
  onImportDashboardData,
  onResetDashboardData,
  onUpdateNewsKeywords,
}: {
  holdingsData: Holding[]
  watchlistData: WatchItem[]
  newsKeywordsData: string[]
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
  dataReliability: DataReliability
  dataFreshness: DataFreshness
  backupData: StoredDashboardData
  onImportDashboardData: (data: StoredDashboardData) => void
  onResetDashboardData: () => void
  onUpdateNewsKeywords: (keywords: string[]) => void
}) {
  const [backupText, setBackupText] = useState('')
  const [backupMessage, setBackupMessage] = useState('현재 브라우저에 저장된 개인 데이터를 백업하거나 복원할 수 있습니다.')
  const [backupTone, setBackupTone] = useState<'positive' | 'negative' | 'neutral'>('neutral')
  const [keywordInput, setKeywordInput] = useState('')
  const [keywordMessage, setKeywordMessage] = useState('네이버 뉴스 API가 이 키워드 목록을 기준으로 최신 이슈를 수집합니다.')
  const [keywordTone, setKeywordTone] = useState<'positive' | 'negative' | 'neutral'>('neutral')
  const [syncKey, setSyncKey] = useState('')
  const [profileSyncStatus, setProfileSyncStatus] = useState<ProfileSyncStatus>('idle')
  const [profileSyncMessage, setProfileSyncMessage] = useState('서버 동기화 상태 확인 대기')
  const [profileSyncUpdatedAt, setProfileSyncUpdatedAt] = useState<string | null>(null)
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
    { label: '개인 일정', value: `${backupData.calendarEvents.length}개` },
    { label: '뉴스 키워드', value: `${backupData.newsKeywords.length}개` },
    { label: '알림 규칙', value: `${backupData.alertRules.length}개` },
    { label: '알림 기록', value: `${backupData.alertHistory.length}개` },
    { label: '투자노트', value: backupData.journal.date },
    { label: '복기 기록', value: `${backupData.journalHistory.length}개` },
  ]
  const backupMessageVariant = backupTone === 'positive' ? 'positive' : backupTone === 'negative' ? 'negative' : 'neutral'
  const keywordMessageVariant = keywordTone === 'positive' ? 'positive' : keywordTone === 'negative' ? 'negative' : 'neutral'
  const profileSyncBusy = profileSyncStatus === 'checking' || profileSyncStatus === 'saving' || profileSyncStatus === 'loading'
  const reliabilitySourceById = new Map(dataReliability.sources.map((source) => [source.id, source]))
  const runtimeSources = [
    {
      id: 'runtime-quotes',
      reliabilityId: 'quotes',
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
      reliabilityId: 'news',
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
      reliabilityId: 'calendar',
      name: '현재 캘린더',
      status: calendarStatus as DataHealthStatus,
      source: '이벤트 캘린더 수신 상태',
      metric: `${calendarEventCount}개`,
      summary: calendarMessage,
      detail: backupData.calendarEvents.length > 0 ? `개인 일정 ${backupData.calendarEvents.length}개까지 액션 큐에 반영됩니다.` : '장전 점검과 이벤트가 액션 큐에 반영됩니다.',
      coverage: ['매크로', '정책', '실적', '개인 일정'],
    },
    {
      id: 'runtime-disclosures',
      reliabilityId: 'disclosures',
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

  const loadProfileSyncStatus = useCallback(async (signal?: AbortSignal) => {
    setProfileSyncStatus('checking')

    try {
      const response = await fetch('/api/profile?status=1', { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        throw new Error('서버 동기화 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as ProfileSyncApiResponse
      setProfileSyncStatus(payload.configured ? 'ready' : 'missing')
      setProfileSyncMessage(payload.message ?? (payload.configured ? '서버 동기화를 사용할 수 있습니다.' : '서버 동기화 설정이 필요합니다.'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setProfileSyncStatus('error')
      setProfileSyncMessage(error instanceof Error ? error.message : '서버 동기화 상태를 확인하지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadHealth(controller.signal)
    void loadProfileSyncStatus(controller.signal)

    return () => {
      controller.abort()
    }
  }, [loadHealth, loadProfileSyncStatus])

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
      calendarEvents: [],
      newsKeywords: defaultNewsKeywords,
      alertRules: defaultAlertRules,
      alertSettings: defaultAlertSettings,
      alertHistory: [],
      journal: createDefaultJournal(),
      journalHistory: [],
    }
    onResetDashboardData()
    setBackupText(formatDashboardBackup(resetData))
    setBackupTone('positive')
    setBackupMessage('기본 보유/관심종목과 오늘 투자노트로 복원했습니다.')
  }

  const handleAddKeyword = () => {
    const keyword = normalizeNewsKeyword(keywordInput)
    if (!keyword) {
      setKeywordTone('negative')
      setKeywordMessage('추가할 키워드를 입력해주세요.')
      return
    }

    const hasKeyword = newsKeywordsData.some((item) => item.toLocaleLowerCase('ko-KR') === keyword.toLocaleLowerCase('ko-KR'))
    if (hasKeyword) {
      setKeywordTone('neutral')
      setKeywordMessage(`${keyword} 키워드는 이미 추적 중입니다.`)
      setKeywordInput('')
      return
    }

    if (newsKeywordsData.length >= 20) {
      setKeywordTone('negative')
      setKeywordMessage('뉴스 키워드는 최대 20개까지 추적할 수 있습니다.')
      return
    }

    const nextKeywords = normalizeNewsKeywords([...newsKeywordsData, keyword])
    onUpdateNewsKeywords(nextKeywords)
    setKeywordInput('')
    setKeywordTone('positive')
    setKeywordMessage(`${keyword} 키워드를 뉴스 수집 대상에 추가했습니다.`)
  }

  const handleRemoveKeyword = (keyword: string) => {
    const nextKeywords = newsKeywordsData.filter((item) => item !== keyword)
    onUpdateNewsKeywords(nextKeywords.length > 0 ? nextKeywords : defaultNewsKeywords)
    setKeywordTone('positive')
    setKeywordMessage(`${keyword} 키워드를 제거했습니다.`)
  }

  const handleResetKeywords = () => {
    onUpdateNewsKeywords(defaultNewsKeywords)
    setKeywordInput('')
    setKeywordTone('positive')
    setKeywordMessage('기본 뉴스 키워드로 복원했습니다.')
  }

  const handleSaveProfileToServer = async () => {
    if (!syncKey.trim()) {
      setProfileSyncStatus('error')
      setProfileSyncMessage('서버에 저장하려면 동기화 키를 입력해주세요.')
      return
    }

    setProfileSyncStatus('saving')
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-key': syncKey.trim(),
        },
        body: JSON.stringify({ data: backupData }),
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error('서버 동기화 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as ProfileSyncApiResponse
      if (!payload.configured) {
        setProfileSyncStatus('missing')
        setProfileSyncMessage(payload.message ?? '서버 동기화 환경변수 설정이 필요합니다.')
        return
      }
      if (!response.ok) {
        setProfileSyncStatus('error')
        setProfileSyncMessage(payload.message ?? '서버 저장에 실패했습니다.')
        return
      }

      setProfileSyncStatus('ready')
      setProfileSyncUpdatedAt(payload.updatedAt ?? new Date().toISOString())
      setProfileSyncMessage(payload.message ?? '현재 프로필을 서버에 저장했습니다.')
    } catch (error) {
      setProfileSyncStatus('error')
      setProfileSyncMessage(error instanceof Error ? error.message : '서버 저장에 실패했습니다.')
    }
  }

  const handleLoadProfileFromServer = async () => {
    if (!syncKey.trim()) {
      setProfileSyncStatus('error')
      setProfileSyncMessage('서버에서 불러오려면 동기화 키를 입력해주세요.')
      return
    }

    setProfileSyncStatus('loading')
    try {
      const response = await fetch('/api/profile', {
        headers: {
          'x-sync-key': syncKey.trim(),
        },
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error('서버 동기화 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as ProfileSyncApiResponse
      if (!payload.configured) {
        setProfileSyncStatus('missing')
        setProfileSyncMessage(payload.message ?? '서버 동기화 환경변수 설정이 필요합니다.')
        return
      }
      if (!response.ok) {
        setProfileSyncStatus('error')
        setProfileSyncMessage(payload.message ?? '서버 불러오기에 실패했습니다.')
        return
      }
      if (!payload.data) {
        setProfileSyncStatus('empty')
        setProfileSyncMessage(payload.message ?? '아직 서버에 저장된 프로필이 없습니다.')
        return
      }

      const data = normalizeStoredDashboardData(payload.data)
      if (!data) {
        setProfileSyncStatus('error')
        setProfileSyncMessage('서버 프로필 형식이 현재 앱과 맞지 않습니다.')
        return
      }

      onImportDashboardData(data)
      setBackupText(formatDashboardBackup(data))
      setBackupTone('positive')
      setBackupMessage('서버에서 불러온 프로필을 현재 브라우저에 적용했습니다.')
      setProfileSyncStatus('ready')
      setProfileSyncUpdatedAt(payload.updatedAt ?? null)
      setProfileSyncMessage(payload.message ?? '서버 프로필을 불러왔습니다.')
    } catch (error) {
      setProfileSyncStatus('error')
      setProfileSyncMessage(error instanceof Error ? error.message : '서버 불러오기에 실패했습니다.')
    }
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
            {runtimeSources.map((source) => {
              const diagnostic = reliabilitySourceById.get(source.reliabilityId as DataReliability['sources'][number]['id'])

              return (
                <div key={source.id} className="rounded-md border border-border bg-muted/15 p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold">{source.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{source.source}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={diagnostic?.tone ?? dataHealthVariant(source.status)}>{diagnostic?.modeLabel ?? dataModeLabel(source.status)}</Badge>
                      <Badge variant={dataHealthVariant(source.status)}>{dataHealthStatusLabel[source.status]}</Badge>
                      <Badge variant="secondary">{source.metric}</Badge>
                    </div>
                  </div>
                  <div className="text-sm leading-6 text-foreground/85">{source.summary}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{source.detail}</div>
                  {diagnostic ? (
                    <div className="mt-3 grid gap-2 rounded-md border border-border bg-background/60 p-3 text-xs leading-5 text-muted-foreground">
                      <div>
                        <span className="text-foreground/80">호출 경로</span> · {diagnostic.endpoint}
                      </div>
                      <div>
                        <span className="text-foreground/80">필요 설정</span> · {diagnostic.requiredConfig}
                      </div>
                      <div>
                        <span className="text-foreground/80">다음 조치</span> · {diagnostic.nextAction}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {source.coverage.map((item) => (
                      <Badge key={item} variant="secondary">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              )
            })}
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
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge variant={service.configured ? 'positive' : 'negative'}>{service.configured ? '환경변수 OK' : '환경변수 필요'}</Badge>
                    <Badge variant={dataHealthVariant(service.status)}>{dataHealthStatusLabel[service.status]}</Badge>
                  </div>
                </div>
                <div className="mt-3 text-xs leading-5 text-foreground/80">{service.summary}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{service.nextAction}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">{service.cadence}</Badge>
                  {service.requiredEnv && service.requiredEnv.length > 0 ? <Badge variant="neutral">{service.requiredEnv.join(', ')}</Badge> : <Badge variant="neutral">추가 키 없음</Badge>}
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

      <DataFreshnessPanel freshness={dataFreshness} />

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
                {newsKeywordsData.map((keyword) => (
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

      <Card>
        <CardHeader>
          <CardTitle>뉴스 키워드 관리</CardTitle>
          <CardDescription>내 포트폴리오와 내일장 판단에 반영할 네이버 뉴스 검색어</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Badge variant={keywordMessageVariant}>{keywordMessage}</Badge>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleAddKeyword()
                }
              }}
              placeholder="예: HBM, 실적발표, 원전"
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
            />
            <div className="flex gap-2">
              <Button type="button" onClick={handleAddKeyword}>
                <Save className="size-4" />
                추가
              </Button>
              <Button type="button" variant="outline" onClick={handleResetKeywords}>
                <RefreshCw className="size-4" />
                기본값
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {newsKeywordsData.map((keyword) => (
              <button
                key={keyword}
                type="button"
                onClick={() => handleRemoveKeyword(keyword)}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 text-xs text-foreground transition hover:border-negative/40 hover:bg-negative/10"
                aria-label={`${keyword} 키워드 제거`}
              >
                {keyword}
                <X className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">현재 키워드</div>
              <div className="mt-2 text-lg font-semibold">{newsKeywordsData.length}개</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">뉴스 새로고침</div>
              <div className="mt-2 text-lg font-semibold">10분</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">최대 키워드</div>
              <div className="mt-2 text-lg font-semibold">20개</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>서버 동기화</CardTitle>
              <CardDescription>다른 기기에서도 같은 보유종목, 관심종목, 개인 일정, 뉴스 키워드, 알림 규칙, 알림 기록, 투자노트 사용</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadProfileSyncStatus()} disabled={profileSyncBusy}>
              <RefreshCw className={cn('size-4', profileSyncStatus === 'checking' && 'animate-spin')} />
              상태 확인
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={profileSyncVariant(profileSyncStatus)}>{profileSyncStatusLabel[profileSyncStatus]}</Badge>
            {profileSyncUpdatedAt ? <Badge variant="secondary">최근 서버 저장 {formatMarketTime(profileSyncUpdatedAt)}</Badge> : null}
          </div>
          <div className="text-sm leading-6 text-muted-foreground">{profileSyncMessage}</div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={syncKey}
              onChange={(event) => setSyncKey(event.target.value)}
              type="password"
              placeholder="Vercel PROFILE_SYNC_KEY"
              className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void handleSaveProfileToServer()} disabled={profileSyncBusy}>
                <Save className={cn('size-4', profileSyncStatus === 'saving' && 'animate-pulse')} />
                서버 저장
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleLoadProfileFromServer()} disabled={profileSyncBusy}>
                <Download className={cn('size-4', profileSyncStatus === 'loading' && 'animate-pulse')} />
                서버 불러오기
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">저장 대상</div>
              <div className="mt-2 text-sm font-semibold">보유/관심/일정/키워드/알림/노트</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">서버 저장소</div>
              <div className="mt-2 text-sm font-semibold">Upstash Redis REST</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">필요 환경변수</div>
              <div className="mt-2 text-sm font-semibold">3개</div>
            </div>
            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-xs text-muted-foreground">동기화 키</div>
              <div className="mt-2 text-sm font-semibold">브라우저 미저장</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>데이터 백업</CardTitle>
                <CardDescription>보유종목, 관심종목, 개인 일정, 뉴스 키워드, 알림 규칙, 알림 기록, 투자노트와 복기 기록을 JSON 파일로 보관</CardDescription>
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
  notificationPermission: NotificationPermissionState
  onSaveHolding: (holding: Holding, previousSymbol?: string) => void
  onDeleteHolding: (symbol: string) => void
  onResetHoldings: () => void
  onSaveWatchItem: (item: WatchItem, previousSymbol?: string) => void
  onDeleteWatchItem: (symbol: string) => void
  onResetWatchlist: () => void
  onSaveCalendarEvent: (event: CalendarEvent, previousId?: string) => void
  onDeleteCalendarEvent: (id: string) => void
  onResetCalendarEvents: () => void
  onRefreshNews: () => void
  onRefreshDisclosures: () => void
  onRefreshCalendar: () => void
  onUpdateNewsKeywords: (keywords: string[]) => void
  onSaveAlertRule: (rule: AlertRule, previousId?: string) => void
  onDeleteAlertRule: (id: string) => void
  onToggleAlertRule: (id: string) => void
  onResetAlertRules: () => void
  onUpdateAlertSettings: (patch: Partial<AlertSettings>) => void
  onRequestBrowserNotifications: () => Promise<void>
  onMarkAlertHistoryRead: () => void
  onClearAlertHistory: () => void
  onUpdateJournal: (patch: Partial<InvestmentJournal>) => void
  onToggleJournalAction: (actionId: string) => void
  onResetJournal: () => void
  onArchiveJournal: () => void
  onDeleteJournalHistory: (id: string) => void
  onClearJournalHistory: () => void
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
  if (page === 'radar') {
    return <MarketRadarPage leadingIndicatorsData={snapshot.leadingIndicators} biasScoreData={snapshot.biasScore} koreaMarketBridge={snapshot.koreaMarketBridge} marketPulse={snapshot.marketPulse} />
  }
  if (page === 'forecast') {
    return (
      <ForecastPage
        forecast={snapshot.forecast}
        holdingsData={snapshot.holdings}
        leadingIndicatorsData={snapshot.leadingIndicators}
        newsImpactBoard={snapshot.newsImpactBoard}
        catalystRadar={snapshot.catalystRadar}
        marketPulse={snapshot.marketPulse}
        actionQueue={snapshot.actionQueue}
        portfolioPlaybook={snapshot.portfolioPlaybook}
        dataReliability={snapshot.dataReliability}
        dataFreshness={snapshot.dataFreshness}
        signalAudit={snapshot.signalAudit}
        forecastSensitivity={snapshot.forecastSensitivity}
        overnightStressTest={snapshot.overnightStressTest}
        preMarketCommand={snapshot.preMarketCommand}
        marketSession={snapshot.marketSession}
        executionPlan={snapshot.executionPlan}
        usdKrw={snapshot.usdKrw}
      />
    )
  }
  if (page === 'news') {
    return (
      <NewsPage
        holdingsData={snapshot.holdings}
        newsKeywordsData={snapshot.newsKeywords}
        liveNews={snapshot.liveNews}
        newsStatus={snapshot.newsStatus}
        newsMessage={snapshot.newsMessage}
        newsImpactBoard={snapshot.newsImpactBoard}
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
        personalEvents={snapshot.storedData.calendarEvents}
        calendarStatus={snapshot.calendarStatus}
        calendarMessage={snapshot.calendarMessage}
        onRefreshCalendar={actions.onRefreshCalendar}
        onSaveCalendarEvent={actions.onSaveCalendarEvent}
        onDeleteCalendarEvent={actions.onDeleteCalendarEvent}
        onResetCalendarEvents={actions.onResetCalendarEvents}
      />
    )
  }
  if (page === 'alerts') {
    return (
      <AlertsPage
        actionQueue={snapshot.actionQueue}
        alertRules={snapshot.alertRules}
        alertSettings={snapshot.alertSettings}
        alertHistory={snapshot.alertHistory}
        notificationPermission={actions.notificationPermission}
        triggeredAlerts={snapshot.triggeredAlerts}
        onSaveAlertRule={actions.onSaveAlertRule}
        onDeleteAlertRule={actions.onDeleteAlertRule}
        onToggleAlertRule={actions.onToggleAlertRule}
        onResetAlertRules={actions.onResetAlertRules}
        onUpdateAlertSettings={actions.onUpdateAlertSettings}
        onRequestBrowserNotifications={actions.onRequestBrowserNotifications}
        onMarkAlertHistoryRead={actions.onMarkAlertHistoryRead}
        onClearAlertHistory={actions.onClearAlertHistory}
      />
    )
  }
  if (page === 'notes') {
    return (
      <NotesPage
        actionQueue={snapshot.actionQueue}
        journal={snapshot.journal}
        journalHistory={snapshot.storedData.journalHistory}
        biasScoreData={snapshot.biasScore}
        marketStatusData={snapshot.marketStatus}
        morningBrief={snapshot.morningBrief}
        marketSession={snapshot.marketSession}
        forecastReview={snapshot.forecastReview}
        forecastCalibration={snapshot.forecastCalibration}
        executionPlan={snapshot.executionPlan}
        onUpdateJournal={actions.onUpdateJournal}
        onToggleJournalAction={actions.onToggleJournalAction}
        onResetJournal={actions.onResetJournal}
        onArchiveJournal={actions.onArchiveJournal}
        onDeleteJournalHistory={actions.onDeleteJournalHistory}
        onClearJournalHistory={actions.onClearJournalHistory}
      />
    )
  }
  if (page === 'settings') {
    return (
      <SettingsPage
        holdingsData={snapshot.holdings}
        watchlistData={snapshot.watchlist}
        newsKeywordsData={snapshot.newsKeywords}
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
        dataReliability={snapshot.dataReliability}
        dataFreshness={snapshot.dataFreshness}
        backupData={snapshot.storedData}
        onImportDashboardData={actions.onImportDashboardData}
        onResetDashboardData={actions.onResetDashboardData}
        onUpdateNewsKeywords={actions.onUpdateNewsKeywords}
      />
    )
  }
  return null
}

export function Dashboard() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [userHoldings, setUserHoldings] = useState<Holding[]>(holdings)
  const [userWatchlist, setUserWatchlist] = useState<WatchItem[]>(watchlist)
  const [userCalendarEvents, setUserCalendarEvents] = useState<CalendarEvent[]>([])
  const [userNewsKeywords, setUserNewsKeywords] = useState<string[]>(defaultNewsKeywords)
  const [userAlertRules, setUserAlertRules] = useState<AlertRule[]>(defaultAlertRules)
  const [userAlertSettings, setUserAlertSettings] = useState<AlertSettings>(defaultAlertSettings)
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([])
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() =>
    typeof window === 'undefined' ? 'unsupported' : getNotificationPermissionState(),
  )
  const alertHistoryRef = useRef<AlertHistoryItem[]>([])
  const [journal, setJournal] = useState<InvestmentJournal>(() => createDefaultJournal())
  const [journalHistory, setJournalHistory] = useState<JournalHistoryItem[]>([])
  const [storageLoaded, setStorageLoaded] = useState(false)
  const [quoteResponse, setQuoteResponse] = useState<QuotesApiResponse | null>(null)
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>('idle')
  const [quoteMessage, setQuoteMessage] = useState('시세 연결 대기')
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [calendarResponse, setCalendarResponse] = useState<CalendarApiResponse | null>(null)
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>('idle')
  const [calendarMessage, setCalendarMessage] = useState('캘린더 연결 대기')
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>([])
  const [newsFetchedAt, setNewsFetchedAt] = useState<string | null>(null)
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
        keywords: userNewsKeywords.join(','),
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
        setNewsFetchedAt(payload.fetchedAt ?? new Date().toISOString())
        setNewsStatus('error')
        setNewsMessage(payload.message ?? '네이버 뉴스 API 호출에 실패했습니다.')
        return
      }

      if (!payload.configured) {
        setLiveNews([])
        setNewsFetchedAt(payload.fetchedAt ?? new Date().toISOString())
        setNewsStatus('fallback')
        setNewsMessage(payload.message ?? '네이버 뉴스 API 환경변수 설정이 필요합니다.')
        return
      }

      setLiveNews(payload.items)
      setNewsFetchedAt(payload.fetchedAt ?? new Date().toISOString())
      setNewsStatus(payload.items.length > 0 ? 'ready' : 'fallback')
      setNewsMessage(payload.items.length > 0 ? `최근 수집 ${formatNewsTime(payload.fetchedAt ?? '')}` : '수집된 뉴스가 없습니다.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setLiveNews([])
      setNewsFetchedAt(null)
      setNewsStatus('error')
      setNewsMessage(error instanceof Error ? error.message : '뉴스를 불러오지 못했습니다.')
    }
  }, [userNewsKeywords])
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
      setUserCalendarEvents(stored.calendarEvents)
      setUserNewsKeywords(stored.newsKeywords)
      setUserAlertRules(stored.alertRules)
      setUserAlertSettings(stored.alertSettings)
      setAlertHistory(stored.alertHistory)
      setJournal(stored.journal)
      setJournalHistory(stored.journalHistory)
    }
    setStorageLoaded(true)
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(new Date())
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!storageLoaded) return
    saveStoredDashboardData({
      holdings: userHoldings,
      watchlist: userWatchlist,
      calendarEvents: userCalendarEvents,
      newsKeywords: userNewsKeywords,
      alertRules: userAlertRules,
      alertSettings: userAlertSettings,
      alertHistory,
      journal,
      journalHistory,
    })
  }, [alertHistory, journal, journalHistory, storageLoaded, userAlertRules, userAlertSettings, userCalendarEvents, userHoldings, userNewsKeywords, userWatchlist])

  useEffect(() => {
    alertHistoryRef.current = alertHistory
  }, [alertHistory])

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
    () => {
      const automaticCalendarEvents = calendarResponse?.events.length ? calendarResponse.events : fallbackCalendarEvents
      return buildDashboardSnapshot({
        quotes: quoteResponse?.quotes ?? [],
        baseHoldings: userHoldings,
        baseWatchlist: userWatchlist,
        userCalendarEvents,
        newsKeywordsData: userNewsKeywords,
        alertRulesData: userAlertRules,
        alertSettingsData: userAlertSettings,
        alertHistoryData: alertHistory,
        journalHistoryData: journalHistory,
        fetchedAt: quoteResponse?.fetchedAt ?? null,
        newsFetchedAt,
        calendarFetchedAt: calendarResponse?.fetchedAt ?? null,
        disclosureFetchedAt: disclosureResponse?.fetchedAt ?? null,
        quoteStatus,
        quoteMessage,
        calendarEventsData: mergeCalendarEvents(automaticCalendarEvents, userCalendarEvents),
        calendarStatus,
        calendarMessage,
        liveNews,
        newsStatus,
        newsMessage,
        disclosures: disclosureResponse?.items ?? [],
        disclosureStatus,
        disclosureMessage,
        journal,
        now: currentTime,
      })
    },
    [
      calendarMessage,
      calendarResponse,
      calendarStatus,
      disclosureMessage,
      disclosureResponse,
      disclosureStatus,
      currentTime,
      liveNews,
      journal,
      journalHistory,
      newsMessage,
      newsFetchedAt,
      newsStatus,
      quoteMessage,
      quoteResponse,
      quoteStatus,
      alertHistory,
      userAlertRules,
      userAlertSettings,
      userCalendarEvents,
      userHoldings,
      userNewsKeywords,
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
  const dataRefreshBusy =
    quoteStatus === 'loading' || newsStatus === 'loading' || calendarStatus === 'loading' || disclosureStatus === 'loading'
  const refreshAllData = () => {
    void loadQuotes()
    void loadLiveNews()
    void loadCalendar()
    void loadDisclosures()
  }

  useEffect(() => {
    setNotificationPermission(getNotificationPermissionState())
  }, [])

  useEffect(() => {
    if (!storageLoaded || snapshot.triggeredAlerts.length === 0) return

    const existingKeys = new Set(alertHistoryRef.current.map((item) => item.dedupeKey))
    const additions = snapshot.triggeredAlerts
      .filter((alert) => !existingKeys.has(alertDedupeKey(alert)))
      .map((alert) => createAlertHistoryItem(alert, sendBrowserNotification(alert, userAlertSettings)))

    if (additions.length === 0) return

    setAlertHistory((current) => dedupeAlertHistory([...additions, ...current]).slice(0, 100))
  }, [snapshot.triggeredAlerts, storageLoaded, userAlertSettings])

  const actions = useMemo<DashboardActions>(
    () => ({
      notificationPermission,
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
      },
      onSaveCalendarEvent: (event, previousId) => {
        setUserCalendarEvents((current) => {
          const removeId = previousId ?? event.id
          const remaining = current.filter((item) => item.id !== removeId && item.id !== event.id)
          return mergeCalendarEvents([], [...remaining, event]).slice(0, 60)
        })
      },
      onDeleteCalendarEvent: (id) => {
        setUserCalendarEvents((current) => current.filter((event) => event.id !== id))
      },
      onResetCalendarEvents: () => {
        setUserCalendarEvents([])
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
      onUpdateNewsKeywords: (keywords) => {
        setUserNewsKeywords(normalizeNewsKeywords(keywords))
      },
      onSaveAlertRule: (rule, previousId) => {
        setUserAlertRules((current) => {
          const removeId = previousId ?? rule.id
          const remaining = current.filter((item) => item.id !== removeId && item.id !== rule.id)
          return [...remaining, rule]
        })
      },
      onDeleteAlertRule: (id) => {
        setUserAlertRules((current) => current.filter((rule) => rule.id !== id))
      },
      onToggleAlertRule: (id) => {
        setUserAlertRules((current) => current.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)))
      },
      onResetAlertRules: () => {
        setUserAlertRules(defaultAlertRules)
      },
      onUpdateAlertSettings: (patch) => {
        setUserAlertSettings((current) => normalizeAlertSettings({ ...current, ...patch }))
      },
      onRequestBrowserNotifications: async () => {
        if (typeof window === 'undefined' || !('Notification' in window)) {
          setNotificationPermission('unsupported')
          setUserAlertSettings((current) => ({ ...current, browserNotifications: false }))
          return
        }

        try {
          const permission = await window.Notification.requestPermission()
          setNotificationPermission(permission)
          setUserAlertSettings((current) => ({
            ...current,
            browserNotifications: permission === 'granted',
          }))
        } catch {
          setNotificationPermission(getNotificationPermissionState())
          setUserAlertSettings((current) => ({ ...current, browserNotifications: false }))
        }
      },
      onMarkAlertHistoryRead: () => {
        setAlertHistory((current) => current.map((item) => ({ ...item, read: true })))
      },
      onClearAlertHistory: () => {
        setAlertHistory([])
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
      onArchiveJournal: () => {
        const normalized = normalizeJournal(journal)
        if (!hasJournalContent(normalized)) return

        setJournalHistory((current) =>
          dedupeJournalHistory([
            createJournalHistoryItem({
              journal: normalized,
              forecastReview: snapshot.forecastReview,
              actionQueue: snapshot.actionQueue,
            }),
            ...current,
          ]),
        )
      },
      onDeleteJournalHistory: (id) => {
        setJournalHistory((current) => current.filter((item) => item.id !== id))
      },
      onClearJournalHistory: () => {
        setJournalHistory([])
      },
      onImportDashboardData: (data) => {
        setUserHoldings(data.holdings)
        setUserWatchlist(data.watchlist)
        setUserCalendarEvents(data.calendarEvents)
        setUserNewsKeywords(data.newsKeywords)
        setUserAlertRules(data.alertRules)
        setUserAlertSettings(data.alertSettings)
        setAlertHistory(data.alertHistory)
        setJournal(data.journal)
        setJournalHistory(data.journalHistory)
        saveStoredDashboardData(data)
      },
      onResetDashboardData: () => {
        const nextJournal = createDefaultJournal()
        setUserHoldings(holdings)
        setUserWatchlist(watchlist)
        setUserCalendarEvents([])
        setUserNewsKeywords(defaultNewsKeywords)
        setUserAlertRules(defaultAlertRules)
        setUserAlertSettings(defaultAlertSettings)
        setAlertHistory([])
        setJournal(nextJournal)
        setJournalHistory([])
        saveStoredDashboardData({
          holdings,
          watchlist,
          calendarEvents: [],
          newsKeywords: defaultNewsKeywords,
          alertRules: defaultAlertRules,
          alertSettings: defaultAlertSettings,
          alertHistory: [],
          journal: nextJournal,
          journalHistory: [],
        })
      },
    }),
    [journal, loadCalendar, loadDisclosures, loadLiveNews, notificationPermission, snapshot.actionQueue, snapshot.forecastReview],
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

            <PreMarketCommandCenterPanel command={snapshot.preMarketCommand} compact />

            <MarketSessionControlPanel session={snapshot.marketSession} compact />

            <CatalystRadarPanel radar={snapshot.catalystRadar} compact />

            <MarketPulseRailPanel pulse={snapshot.marketPulse} compact />

            <OvernightStressTestPanel stress={snapshot.overnightStressTest} compact />

            <NewsImpactBoardPanel board={snapshot.newsImpactBoard} compact />

            <DataReliabilityPanel reliability={snapshot.dataReliability} onRefreshAll={refreshAllData} refreshing={dataRefreshBusy} compact />

            <DataFreshnessPanel freshness={snapshot.dataFreshness} onRefreshAll={refreshAllData} refreshing={dataRefreshBusy} compact />

            <SignalAuditPanel audit={snapshot.signalAudit} compact />

            <ForecastSensitivityPanel sensitivity={snapshot.forecastSensitivity} compact />

            <KoreaMarketBridgePanel bridge={snapshot.koreaMarketBridge} compact />

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

            <MorningBriefPanel brief={snapshot.morningBrief} compact />

            <ForecastCalibrationPanel calibration={snapshot.forecastCalibration} compact />

            <PortfolioPlaybookPanel playbook={snapshot.portfolioPlaybook} compact />

            <ExecutionPlanPanel plan={snapshot.executionPlan} compact />

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
