const DEFAULT_QUOTES = [
  { symbol: '005930', sourceSymbol: '005930.KS', name: '삼성전자', market: 'KR', type: 'stock' },
  { symbol: '000660', sourceSymbol: '000660.KS', name: 'SK하이닉스', market: 'KR', type: 'stock' },
  { symbol: '035420', sourceSymbol: '035420.KS', name: 'NAVER', market: 'KR', type: 'stock' },
  { symbol: '373220', sourceSymbol: '373220.KS', name: 'LG에너지솔루션', market: 'KR', type: 'stock' },
  { symbol: 'AAPL', sourceSymbol: 'AAPL', name: 'Apple', market: 'US', type: 'stock' },
  { symbol: 'TSLA', sourceSymbol: 'TSLA', name: 'Tesla', market: 'US', type: 'stock' },
  { symbol: 'NVDA', sourceSymbol: 'NVDA', name: 'NVIDIA', market: 'US', type: 'stock' },
  { symbol: 'NQ=F', sourceSymbol: 'NQ=F', name: '나스닥100 선물', market: 'US', type: 'indicator' },
  { symbol: 'ES=F', sourceSymbol: 'ES=F', name: 'S&P500 선물', market: 'US', type: 'indicator' },
  { symbol: 'SOX', sourceSymbol: '^SOX', name: '필라델피아 반도체', market: 'US', type: 'indicator' },
  { symbol: 'VIX', sourceSymbol: '^VIX', name: '변동성 지수', market: 'US', type: 'indicator' },
  { symbol: 'DXY', sourceSymbol: 'DX-Y.NYB', name: '달러 인덱스', market: 'US', type: 'indicator' },
  { symbol: 'US10Y', sourceSymbol: '^TNX', name: '미국 10년물 금리', market: 'US', type: 'indicator' },
  { symbol: 'USD/KRW', sourceSymbol: 'KRW=X', name: '달러/원', market: 'KR', type: 'indicator' },
]

const REQUEST_DELAY_MS = 120
const RETRY_DELAY_MS = 700

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase()
}

function findQuoteConfig(symbol) {
  const normalized = normalizeSymbol(symbol)

  return DEFAULT_QUOTES.find(
    (quote) => normalizeSymbol(quote.symbol) === normalized || normalizeSymbol(quote.sourceSymbol) === normalized,
  )
}

function getQuoteConfigs(rawSymbols) {
  if (!rawSymbols) return DEFAULT_QUOTES

  const seen = new Set()
  return rawSymbols
    .split(',')
    .map((symbol) => findQuoteConfig(symbol))
    .filter(Boolean)
    .filter((quote) => {
      if (seen.has(quote.symbol)) return false
      seen.add(quote.symbol)
      return true
    })
    .slice(0, DEFAULT_QUOTES.length)
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }

  return null
}

function toQuote(config, payload) {
  const result = payload?.chart?.result?.[0]
  const meta = result?.meta ?? {}
  const scale = config.valueScale ?? 1
  const rawPrice = pickNumber(meta.regularMarketPrice, meta.previousClose, result?.indicators?.quote?.[0]?.close?.at(-1))
  const rawPreviousClose = pickNumber(meta.previousClose, meta.chartPreviousClose)

  if (rawPrice === null) {
    throw new Error(`${config.symbol} 가격 데이터가 없습니다.`)
  }

  const price = rawPrice * scale
  const previousClose = rawPreviousClose === null ? null : rawPreviousClose * scale
  const change = previousClose === null ? null : price - previousClose
  const changePercent = previousClose && previousClose !== 0 ? (change / previousClose) * 100 : null
  const updatedAt =
    typeof meta.regularMarketTime === 'number'
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString()

  return {
    symbol: config.symbol,
    sourceSymbol: config.sourceSymbol,
    name: config.name,
    market: config.market,
    type: config.type,
    currency: meta.currency ?? (config.market === 'KR' ? 'KRW' : 'USD'),
    exchange: meta.exchangeName ?? meta.fullExchangeName ?? null,
    price,
    previousClose,
    change,
    changePercent,
    updatedAt,
    source: 'Yahoo Finance chart',
  }
}

async function requestYahooChart(config, attempt = 0) {
  const params = new URLSearchParams({
    range: '5d',
    interval: '1d',
  })
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.sourceSymbol)}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 TrackingMoney/1.0',
    },
  })

  if (response.status === 429 && attempt < 2) {
    await sleep(RETRY_DELAY_MS * (attempt + 1))
    return requestYahooChart(config, attempt + 1)
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Yahoo ${response.status}: ${message.slice(0, 160)}`)
  }

  return response.json()
}

async function fetchQuote(config) {
  const payload = await requestYahooChart(config)
  return toQuote(config, payload)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET 요청만 지원합니다.' })
    return
  }

  const url = new URL(req.url, `https://${req.headers.host ?? 'tracking-money.vercel.app'}`)
  const quoteConfigs = getQuoteConfigs(url.searchParams.get('symbols'))
  const quotes = []
  const errors = []

  for (const [index, config] of quoteConfigs.entries()) {
    try {
      const quote = await fetchQuote(config)
      quotes.push(quote)
    } catch (error) {
      errors.push({
        symbol: config.symbol,
        sourceSymbol: config.sourceSymbol,
        message: error instanceof Error ? error.message : '시세 수집 실패',
      })
    }

    if (index < quoteConfigs.length - 1) {
      await sleep(REQUEST_DELAY_MS)
    }
  }

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=240')
  sendJson(res, 200, {
    configured: true,
    source: 'Yahoo Finance chart',
    fetchedAt: new Date().toISOString(),
    status: quotes.length > 0 ? (errors.length > 0 ? 'partial' : 'ready') : 'fallback',
    quotes,
    errors,
    message:
      errors.length > 0
        ? quotes.length > 0
          ? `일부 시세는 수집하지 못했습니다: ${errors
              .slice(0, 4)
              .map((error) => error.symbol)
              .join(', ')}`
          : errors[0].message
        : undefined,
  })
}
