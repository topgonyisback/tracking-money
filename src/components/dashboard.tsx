import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  CalendarDays,
  ChartCandlestick,
  Clock3,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  LineChart,
  Newspaper,
  NotebookPen,
  Radar,
  RefreshCw,
  Settings,
  Star,
  TrendingDown,
  TrendingUp,
  WalletCards,
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
  calendarEvents,
  holdings,
  keyIssues,
  leadingIndicators,
  marketStatus,
  newsKeywords,
  watchlist,
} from '@/data/mock-dashboard'
import { cn } from '@/lib/utils'
import type { Direction, LiveNewsItem } from '@/types/market'

const navItems = [
  { id: 'dashboard', label: '대시보드', subtitle: '국내장 예열과 포트폴리오 영향', icon: LayoutDashboard },
  { id: 'holdings', label: '보유종목', subtitle: '보유 비중, 손익, 이슈 영향', icon: WalletCards },
  { id: 'watchlist', label: '관심종목', subtitle: '매수가 조건과 이슈 트리거', icon: Star },
  { id: 'radar', label: '시장 레이더', subtitle: '선행 지표와 국내장 연결', icon: Radar },
  { id: 'news', label: '뉴스', subtitle: '종목별 이슈와 영향도', icon: Newspaper },
  { id: 'calendar', label: '캘린더', subtitle: '실적, 매크로, 정책 일정', icon: CalendarDays },
  { id: 'notes', label: '투자노트', subtitle: '시나리오와 장 후 리뷰', icon: NotebookPen },
  { id: 'settings', label: '설정', subtitle: '추적 대상과 데이터 주기', icon: Settings },
] as const

type PageId = (typeof navItems)[number]['id']

const indicatorChartData = leadingIndicators.map((indicator) => ({
  symbol: indicator.symbol,
  change: indicator.change,
}))

const biasTimeline = [
  { time: '23:00', score: 42 },
  { time: '01:00', score: 51 },
  { time: '03:00', score: 58 },
  { time: '05:00', score: 61 },
  { time: '08:00', score: biasScore.score },
]

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

const watchStatusLabel = {
  near: '근접',
  waiting: '대기',
  alert: '확인',
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

function holdingProfit(holding: (typeof holdings)[number]) {
  return (holding.currentPrice - holding.averagePrice) * holding.quantity
}

function relatedIssues(symbol: string) {
  return keyIssues.filter((issue) => issue.relatedSymbols.includes(symbol))
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

function PageGrid({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-[1600px] gap-4 p-4 md:p-6">{children}</div>
}

function HoldingsPage() {
  const totalPositions = holdings.length
  const positiveCount = holdings.filter((holding) => holding.impact === 'positive').length
  const riskCount = holdings.filter((holding) => holding.impact === 'negative').length
  const topWeight = holdings.reduce((top, holding) => (holding.portfolioWeight > top.portfolioWeight ? holding : top), holdings[0])

  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="보유 종목" value={`${totalPositions}개`} detail={`${positiveCount}개 우호`} tone="positive" />
        <MetricCard label="최대 비중" value={`${topWeight.name}`} detail={`${topWeight.portfolioWeight}%`} tone="warning" />
        <MetricCard label="이슈 부담" value={`${riskCount}개`} detail="환율/금리 확인" tone={riskCount ? 'negative' : 'neutral'} />
        <MetricCard label="국내장 방향점수" value={`+${biasScore.score}`} detail={`신뢰도 ${confidenceLabel[biasScore.confidence]}`} tone="positive" />
      </section>

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding) => {
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
            {holdings.map((holding) => (
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

function WatchlistPage() {
  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="관심종목" value={`${watchlist.length}개`} detail="조건 추적" />
        <MetricCard label="매수가 근접" value={`${watchlist.filter((item) => item.status === 'near').length}개`} detail="우선 확인" tone="positive" />
        <MetricCard label="이슈 확인" value={`${watchlist.filter((item) => item.status === 'alert').length}개`} detail="뉴스 연결" tone="warning" />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {watchlist.map((item) => (
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
            </CardContent>
          </Card>
        ))}
      </section>
    </PageGrid>
  )
}

function MarketRadarPage() {
  return (
    <PageGrid>
      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>국내장 방향점수</CardTitle>
            <CardDescription>{biasScore.summary}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 text-5xl font-semibold">+{biasScore.score}</div>
            <Progress value={biasScore.score} />
            <div className="mt-4 grid gap-2">
              {[...biasScore.positives, ...biasScore.risks].map((factor) => (
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
        {leadingIndicators.map((indicator) => (
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

function NewsPage() {
  const [activeKeyword, setActiveKeyword] = useState('전체')
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>([])
  const [newsStatus, setNewsStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback' | 'error'>('idle')
  const [newsMessage, setNewsMessage] = useState('')

  const loadLiveNews = useCallback(async (signal?: AbortSignal) => {
    setNewsStatus('loading')
    setNewsMessage('')

    try {
      const params = new URLSearchParams({
        keywords: newsKeywords.join(','),
        display: '3',
      })
      const response = await fetch(`/api/news?${params.toString()}`, { signal })
      const contentType = response.headers.get('content-type') ?? ''

      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('네이버 뉴스 API 응답을 확인할 수 없습니다.')
      }

      const payload = (await response.json()) as NewsApiResponse

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

  useEffect(() => {
    const controller = new AbortController()
    void loadLiveNews(controller.signal)

    return () => controller.abort()
  }, [loadLiveNews])

  const keywordFilters = ['전체', ...newsKeywords]
  const visibleLiveNews = activeKeyword === '전체' ? liveNews : liveNews.filter((item) => item.keyword === activeKeyword)
  const hasLiveNews = liveNews.length > 0
  const highImportanceCount = hasLiveNews
    ? liveNews.filter((item) => item.importance === 'high').length
    : keyIssues.filter((issue) => issue.importance === 'high').length
  const linkedNewsCount = hasLiveNews
    ? liveNews.filter((item) => holdings.some((holding) => item.relatedSymbols.includes(holding.symbol))).length
    : keyIssues.filter((issue) => holdings.some((holding) => issue.relatedSymbols.includes(holding.symbol))).length
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
              <Button type="button" variant="outline" size="sm" onClick={() => void loadLiveNews()} disabled={newsStatus === 'loading'}>
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

function CalendarPage() {
  return (
    <PageGrid>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="오늘 이벤트" value={`${calendarEvents.filter((event) => event.date === '오늘').length}건`} detail="장중/장후 확인" tone="warning" />
        <MetricCard label="실적 관련" value={`${calendarEvents.filter((event) => event.type === 'earnings').length}건`} detail="보유종목 연결" tone="positive" />
        <MetricCard label="매크로/정책" value={`${calendarEvents.filter((event) => event.type !== 'earnings').length}건`} detail="지수 영향" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>이벤트 타임라인</CardTitle>
          <CardDescription>종목과 지표에 연결된 일정</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          {calendarEvents.map((event) => (
            <div key={event.id} className="rounded-md border border-border bg-muted/15 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {event.date} · {event.time}
                </div>
                <Badge variant={event.importance === 'high' ? 'warning' : 'neutral'}>{importanceLabel[event.importance]}</Badge>
              </div>
              <div className="font-medium">{event.title}</div>
              <div className="mt-4 flex flex-wrap gap-2">
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
    </PageGrid>
  )
}

function NotesPage() {
  return (
    <PageGrid>
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

function SettingsPage() {
  const sources = [
    { name: '네이버 뉴스 API', cost: '무료 시작', priority: '우선' },
    { name: 'OpenDART', cost: '무료 시작', priority: '우선' },
    { name: '증권사 Open API', cost: '계좌 연동', priority: '우선' },
    { name: 'FMP / Finnhub / Polygon', cost: '유료 후보', priority: '후순위' },
    { name: 'AI 이슈 요약', cost: '사용량 기반', priority: '후순위' },
  ]
  return (
    <PageGrid>
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
                {holdings.map((holding) => (
                  <Badge key={holding.symbol} variant="secondary">
                    {holding.symbol}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs text-muted-foreground">관심종목</div>
              <div className="flex flex-wrap gap-2">
                {watchlist.map((item) => (
                  <Badge key={item.symbol} variant="secondary">
                    {item.symbol}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs text-muted-foreground">선행 지표</div>
              <div className="flex flex-wrap gap-2">
                {leadingIndicators.map((indicator) => (
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
    </PageGrid>
  )
}

function renderPage(page: PageId) {
  if (page === 'holdings') return <HoldingsPage />
  if (page === 'watchlist') return <WatchlistPage />
  if (page === 'radar') return <MarketRadarPage />
  if (page === 'news') return <NewsPage />
  if (page === 'calendar') return <CalendarPage />
  if (page === 'notes') return <NotesPage />
  if (page === 'settings') return <SettingsPage />
  return null
}

export function Dashboard() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const currentPage = navItems.find((item) => item.id === activePage) ?? navItems[0]

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
                  업데이트 {marketStatus.lastUpdated}
                </Badge>
                <Badge variant="secondary">{marketStatus.usSession}</Badge>
                <Badge variant="warning">국내장 개장 {marketStatus.koreaOpenIn}</Badge>
                <Badge variant="negative">USD/KRW {marketStatus.usdKrw}</Badge>
                <Badge variant="positive">VIX {marketStatus.vix}</Badge>
                <Button size="icon" variant="outline" aria-label="알림">
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
                      <CardDescription>{biasScore.summary}</CardDescription>
                    </div>
                    <Badge variant="positive">신뢰도 {confidenceLabel[biasScore.confidence]}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[0.85fr_1fr]">
                  <div>
                    <div className="mb-2 flex items-end gap-3">
                      <div className="text-5xl font-semibold leading-none text-foreground">+{biasScore.score}</div>
                      <div className="pb-1 text-sm text-muted-foreground">/ 100</div>
                    </div>
                    <div className="mb-4 flex items-center gap-2">
                      <Gauge className="size-4 text-primary" />
                      <span className="text-sm font-medium">우호적이지만 환율 확인 필요</span>
                    </div>
                    <Progress value={biasScore.score} />
                  </div>

                  <div className="grid gap-3 2xl:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">긍정 요인</div>
                      <div className="space-y-2">
                        {biasScore.positives.map((factor) => (
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
                        {biasScore.risks.map((factor) => (
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
                  <CardDescription>국내장 영향 가능성이 큰 순서로 정리</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {keyIssues.map((issue) => (
                    <div key={issue.id} className="rounded-md border border-border bg-muted/15 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">{issue.time}</Badge>
                        <Badge variant={directionVariant(issue.direction)}>{importanceLabel[issue.importance]}</Badge>
                        {issue.sectors.map((sector) => (
                          <Badge key={sector} variant="secondary">
                            {sector}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-sm font-medium leading-5">{issue.title}</div>
                      <div className="mt-2 text-xs leading-5 text-muted-foreground">{issue.expectedImpact}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>미국 선행 지표</CardTitle>
                  <CardDescription>NQ 선물, SOX, 변동성, 달러, 금리, 환율</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {leadingIndicators.map((indicator) => (
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
                      {holdings.map((holding) => (
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
                  {watchlist.map((item) => (
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
                  <CardDescription>매크로, 실적, 정책, 기업 이벤트</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {calendarEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-border bg-muted/15 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          {event.date} · {event.time}
                        </div>
                        <Badge variant={event.importance === 'high' ? 'warning' : 'neutral'}>
                          {importanceLabel[event.importance]}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium">{event.title}</div>
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
            renderPage(activePage)
          )}
        </main>
      </div>
    </div>
  )
}
