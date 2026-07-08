const DEFAULT_SYMBOLS = [
  '005930',
  '000660',
  '035420',
  '373220',
  'AAPL',
  'TSLA',
  'NVDA',
  'NQ=F',
  'SOX',
  'US10Y',
  'USD/KRW',
]

const SYMBOL_PROFILES = {
  '005930': { name: '삼성전자', market: 'KR', sector: '반도체', earningsMonths: [1, 4, 7, 10], earningsWindowDay: 7 },
  '000660': { name: 'SK하이닉스', market: 'KR', sector: '반도체', earningsMonths: [1, 4, 7, 10], earningsWindowDay: 24 },
  '035420': { name: 'NAVER', market: 'KR', sector: '인터넷', earningsMonths: [2, 5, 8, 11], earningsWindowDay: 5 },
  '373220': { name: 'LG에너지솔루션', market: 'KR', sector: '배터리', earningsMonths: [1, 4, 7, 10], earningsWindowDay: 25 },
  AAPL: { name: 'Apple', market: 'US', sector: '하드웨어', earningsMonths: [1, 5, 8, 10], earningsWindowDay: 28 },
  TSLA: { name: 'Tesla', market: 'US', sector: '전기차', earningsMonths: [1, 4, 7, 10], earningsWindowDay: 22 },
  NVDA: { name: 'NVIDIA', market: 'US', sector: 'AI 반도체', earningsMonths: [2, 5, 8, 11], earningsWindowDay: 20 },
}

const IMPORTANCE_SCORE = {
  high: 3,
  medium: 2,
  low: 1,
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase()
}

function getSymbols(rawSymbols) {
  if (!rawSymbols) return DEFAULT_SYMBOLS

  const seen = new Set()
  const symbols = rawSymbols
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean)
    .filter((symbol) => {
      if (seen.has(symbol)) return false
      seen.add(symbol)
      return true
    })
    .slice(0, 30)

  return symbols.length > 0 ? symbols : DEFAULT_SYMBOLS
}

function toKstDate(value) {
  return new Date(value.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

function startOfKstDay(value) {
  const date = toKstDate(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(value, days) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

function dateKey(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isWeekend(value) {
  const day = value.getDay()
  return day === 0 || day === 6
}

function dateLabel(value, today) {
  const diff = Math.round((startOfDay(value).getTime() - startOfDay(today).getTime()) / 86_400_000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '내일'
  if (diff === 2) return '모레'
  return value.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short' })
}

function startOfDay(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function makeEvent(today, event) {
  return {
    id: event.id,
    absoluteDate: dateKey(event.date),
    date: dateLabel(event.date, today),
    time: event.time,
    title: event.title,
    type: event.type,
    importance: event.importance,
    relatedSymbols: event.relatedSymbols,
    status: event.status,
    confidence: event.confidence,
    source: event.source,
    description: event.description,
  }
}

function isWithinRange(date, today, days) {
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / 86_400_000)
  return diff >= 0 && diff <= days
}

function secondWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(year, monthIndex, 1)
  let count = 0

  while (date.getMonth() === monthIndex) {
    if (date.getDay() === weekday) {
      count += 1
      if (count === 2) return new Date(date)
    }
    date.setDate(date.getDate() + 1)
  }

  return new Date(year, monthIndex, 14)
}

function firstWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(year, monthIndex, 1)
  while (date.getMonth() === monthIndex) {
    if (date.getDay() === weekday) return new Date(date)
    date.setDate(date.getDate() + 1)
  }

  return new Date(year, monthIndex, 1)
}

function buildMarketCheckEvents(today, days) {
  const events = []

  for (let offset = 0; offset <= Math.min(days, 6); offset += 1) {
    const date = addDays(today, offset)
    if (isWeekend(date)) continue

    events.push(
      makeEvent(today, {
        id: `market-check-${dateKey(date)}`,
        date,
        time: '08:45',
        title: '국내장 개장 전 미국 선행지표 점검',
        type: 'macro',
        importance: offset === 0 ? 'high' : 'medium',
        relatedSymbols: ['NQ=F', 'SOX', 'VIX', 'USD/KRW', 'US10Y'],
        status: 'watch',
        confidence: 'high',
        source: 'Tracking Money 체크리스트',
        description: '나스닥 선물, SOX, VIX, 달러/원, 미국 10년물을 한 번에 확인하는 매일 점검 이벤트입니다.',
      }),
    )
  }

  return events
}

function buildMacroEvents(today, days) {
  const events = []
  const monthsToCheck = [0, 1].map((offset) => new Date(today.getFullYear(), today.getMonth() + offset, 1))

  for (const monthBase of monthsToCheck) {
    const year = monthBase.getFullYear()
    const month = monthBase.getMonth()
    const cpiDate = secondWeekdayOfMonth(year, month, 3)
    const jobsDate = firstWeekdayOfMonth(year, month, 5)
    const optionsDate = secondWeekdayOfMonth(year, month, 4)

    if (isWithinRange(cpiDate, today, days)) {
      events.push(
        makeEvent(today, {
          id: `us-cpi-${dateKey(cpiDate)}`,
          date: cpiDate,
          time: '21:30',
          title: '미국 CPI 발표 주간',
          type: 'macro',
          importance: 'high',
          relatedSymbols: ['NQ=F', 'US10Y', 'USD/KRW', 'DXY'],
          status: 'estimated',
          confidence: 'medium',
          source: '월간 매크로 일정 규칙',
          description: '정확한 발표일은 공식 캘린더로 재확인하고, 금리와 환율 반응을 우선 추적합니다.',
        }),
      )
    }

    if (isWithinRange(jobsDate, today, days)) {
      events.push(
        makeEvent(today, {
          id: `us-jobs-${dateKey(jobsDate)}`,
          date: jobsDate,
          time: '21:30',
          title: '미국 고용보고서 확인',
          type: 'macro',
          importance: 'medium',
          relatedSymbols: ['NQ=F', 'US10Y', 'USD/KRW'],
          status: 'estimated',
          confidence: 'medium',
          source: '월간 매크로 일정 규칙',
          description: '고용 서프라이즈는 금리와 성장주 밸류에이션에 직접 반영될 수 있습니다.',
        }),
      )
    }

    if (isWithinRange(optionsDate, today, days)) {
      events.push(
        makeEvent(today, {
          id: `kospi-options-${dateKey(optionsDate)}`,
          date: optionsDate,
          time: '15:20',
          title: '코스피200 옵션만기 점검',
          type: 'policy',
          importance: 'medium',
          relatedSymbols: ['KOSPI', 'USD/KRW'],
          status: 'estimated',
          confidence: 'medium',
          source: '한국시장 월간 이벤트 규칙',
          description: '장 막판 수급 왜곡 가능성이 있어 보유종목 변동성을 따로 확인합니다.',
        }),
      )
    }
  }

  return events
}

function buildEarningsEvents(today, days, symbols) {
  const events = []
  const symbolSet = new Set(symbols)
  const monthsToCheck = [0, 1].map((offset) => new Date(today.getFullYear(), today.getMonth() + offset, 1))

  for (const symbol of symbolSet) {
    const profile = SYMBOL_PROFILES[symbol]
    if (!profile) continue

    for (const monthBase of monthsToCheck) {
      const month = monthBase.getMonth() + 1
      if (!profile.earningsMonths.includes(month)) continue

      const date = new Date(monthBase.getFullYear(), monthBase.getMonth(), profile.earningsWindowDay)
      if (!isWithinRange(date, today, days)) continue

      const isKorea = profile.market === 'KR'
      events.push(
        makeEvent(today, {
          id: `earnings-${symbol}-${dateKey(date)}`,
          date,
          time: isKorea ? '08:00' : '장후',
          title: `${profile.name} 실적 발표 구간 확인`,
          type: 'earnings',
          importance: ['005930', '000660', 'NVDA', 'TSLA', 'AAPL'].includes(symbol) ? 'high' : 'medium',
          relatedSymbols: [symbol, profile.sector],
          status: 'estimated',
          confidence: 'medium',
          source: '종목별 과거 발표 구간 규칙',
          description: '정확한 발표일은 회사 IR 공지로 재확인하고, 가이던스와 컨센서스 차이를 우선 기록합니다.',
        }),
      )
    }
  }

  return events
}

function buildPolicyEvents(today, days) {
  const fomcDates = [
    '2026-01-28',
    '2026-03-18',
    '2026-04-29',
    '2026-06-17',
    '2026-07-29',
    '2026-09-16',
    '2026-10-28',
    '2026-12-09',
  ].map((value) => {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  })

  return fomcDates
    .filter((date) => isWithinRange(date, today, days))
    .map((date) =>
      makeEvent(today, {
        id: `fomc-${dateKey(date)}`,
        date,
        time: '03:00',
        title: 'FOMC 금리 결정 및 파월 발언',
        type: 'policy',
        importance: 'high',
        relatedSymbols: ['NQ=F', 'US10Y', 'DXY', 'USD/KRW'],
        status: 'watch',
        confidence: 'medium',
        source: 'Tracking Money 정책 이벤트 목록',
        description: '금리 경로와 점도표, 기자회견 문구가 국내 성장주와 환율에 영향을 줄 수 있습니다.',
      }),
    )
}

function buildEvents({ today, days, symbols }) {
  const events = [
    ...buildMarketCheckEvents(today, days),
    ...buildMacroEvents(today, days),
    ...buildPolicyEvents(today, days),
    ...buildEarningsEvents(today, days, symbols),
  ]
  const seen = new Set()

  return events
    .filter((event) => {
      if (seen.has(event.id)) return false
      seen.add(event.id)
      return true
    })
    .sort((a, b) => {
      const dateDiff = `${a.absoluteDate} ${a.time}`.localeCompare(`${b.absoluteDate} ${b.time}`)
      if (dateDiff !== 0) return dateDiff
      return IMPORTANCE_SCORE[b.importance] - IMPORTANCE_SCORE[a.importance]
    })
    .slice(0, 24)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET 요청만 지원합니다.' })
    return
  }

  const url = new URL(req.url, `https://${req.headers.host ?? 'tracking-money.vercel.app'}`)
  const symbols = getSymbols(url.searchParams.get('symbols'))
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 21), 3), 60)
  const asOfParam = url.searchParams.get('asOf')
  const asOfDate = asOfParam ? new Date(asOfParam) : new Date()
  const today = startOfKstDay(Number.isNaN(asOfDate.getTime()) ? new Date() : asOfDate)
  const events = buildEvents({ today, days, symbols })

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600')
  sendJson(res, 200, {
    configured: true,
    source: 'Tracking Money calendar rules',
    fetchedAt: new Date().toISOString(),
    asOf: dateKey(today),
    days,
    symbols,
    status: 'ready',
    events,
    message: '공개 API 키 없이 추적 가능한 매크로/실적 점검 캘린더입니다. estimated 항목은 공식 일정으로 재확인하세요.',
  })
}
