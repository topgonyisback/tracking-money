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

export type CalendarEvent = {
  id: string
  date: string
  time: string
  title: string
  type: 'earnings' | 'macro' | 'policy' | 'company' | 'dividend'
  importance: 'low' | 'medium' | 'high'
  relatedSymbols: string[]
}

export type ActionMemo = {
  bullishScenario: string
  bearishScenario: string
  watchBeforeOpen: string[]
  afterMarketReview: string
}
