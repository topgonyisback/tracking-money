export type Direction = 'positive' | 'negative' | 'neutral' | 'mixed'

export type Confidence = 'low' | 'medium' | 'high'

export type MarketIndicator = {
  symbol: string
  name: string
  value: string
  change: number
  direction: Direction
  signal: 'risk-on' | 'risk-off' | 'watch'
  note: string
}

export type MarketQuote = {
  symbol: string
  sourceSymbol: string
  name: string
  market: 'KR' | 'US'
  type: 'stock' | 'indicator'
  currency: string
  exchange: string | null
  price: number
  previousClose: number | null
  change: number | null
  changePercent: number | null
  updatedAt: string
  source: string
}

export type BiasFactor = {
  label: string
  impact: number
  direction: Direction
}

export type BiasScore = {
  market: 'KOSPI' | 'KOSDAQ'
  score: number
  stance: 'favorable' | 'neutral' | 'pressure'
  confidence: Confidence
  summary: string
  positives: BiasFactor[]
  risks: BiasFactor[]
}

export type Holding = {
  symbol: string
  name: string
  market: 'KR' | 'US'
  quantity: number
  averagePrice: number
  currentPrice: number
  dayChange: number
  portfolioWeight: number
  impact: Direction
  impactNote: string
}

export type WatchItem = {
  symbol: string
  name: string
  targetBuyPrice: number
  currentPrice: number
  distanceToBuy: number
  trigger: string
  status: 'near' | 'waiting' | 'alert'
}

export type NewsIssue = {
  id: string
  time: string
  title: string
  source: string
  relatedSymbols: string[]
  sectors: string[]
  direction: Direction
  importance: 'low' | 'medium' | 'high'
  confidence: Confidence
  expectedImpact: string
}

export type LiveNewsItem = {
  id: string
  keyword: string
  title: string
  source: string
  link: string
  description: string
  publishedAt: string
  direction: Direction
  importance: 'low' | 'medium' | 'high'
  confidence: Confidence
  relatedSymbols: string[]
  sectors: string[]
  expectedImpact: string
}

export type CalendarEvent = {
  id: string
  date: string
  absoluteDate?: string
  time: string
  title: string
  type: 'earnings' | 'macro' | 'policy' | 'company' | 'dividend'
  importance: 'low' | 'medium' | 'high'
  relatedSymbols: string[]
  status?: 'confirmed' | 'estimated' | 'watch'
  confidence?: Confidence
  source?: string
  description?: string
}

export type DisclosureItem = {
  id: string
  symbol: string
  corpCode: string
  corpName: string
  stockCode: string
  market: 'KR' | 'US'
  sector: string
  reportName: string
  submitter: string
  submittedAt: string
  receiptNo: string
  link: string
  note: string
  source: string
  direction: Direction
  importance: 'low' | 'medium' | 'high'
  expectedImpact: string
}

export type ActionQueueItem = {
  id: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: 'market' | 'portfolio' | 'watchlist' | 'news' | 'calendar' | 'disclosure'
  title: string
  summary: string
  reason: string
  suggestedAction: string
  relatedSymbols: string[]
  evidence: string
  score: number
}

export type InvestmentJournal = {
  date: string
  preMarketPlan: string
  riskPlan: string
  afterMarketReview: string
  completedActionIds: string[]
  lastSavedAt: string | null
}

export type ActionMemo = {
  bullishScenario: string
  bearishScenario: string
  watchBeforeOpen: string[]
  afterMarketReview: string
}
