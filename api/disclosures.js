const DEFAULT_SYMBOLS = ['005930', '000660', '035420', '373220']

const CORP_PROFILES = {
  '005930': { corpCode: '00126380', name: '삼성전자', market: 'KR', sector: '반도체' },
  '000660': { corpCode: '00164779', name: 'SK하이닉스', market: 'KR', sector: '반도체' },
  '035420': { corpCode: '00266961', name: 'NAVER', market: 'KR', sector: '인터넷' },
  '373220': { corpCode: '01515323', name: 'LG에너지솔루션', market: 'KR', sector: '배터리' },
}

const REQUEST_DELAY_MS = 140
const RETRY_DELAY_MS = 800

const POSITIVE_WORDS = ['영업실적', '잠정실적', '공급계약', '수주', '자기주식취득', '배당', '증가', '흑자', '투자']
const NEGATIVE_WORDS = ['정정', '손상', '소송', '벌금', '제재', '적자', '감소', '해지', '거래정지', '횡령', '배임']
const HIGH_IMPORTANCE_WORDS = [
  '잠정실적',
  '영업실적',
  '주요사항보고서',
  '공급계약',
  '타법인',
  '유상증자',
  '무상증자',
  '자기주식',
  '합병',
  '분할',
  '감사보고서',
  '소송',
  '거래정지',
]

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

function getSymbols(rawSymbols) {
  if (!rawSymbols) return DEFAULT_SYMBOLS

  const seen = new Set()
  const symbols = rawSymbols
    .split(',')
    .map(normalizeSymbol)
    .filter((symbol) => CORP_PROFILES[symbol])
    .filter((symbol) => {
      if (seen.has(symbol)) return false
      seen.add(symbol)
      return true
    })
    .slice(0, 10)

  return symbols.length > 0 ? symbols : DEFAULT_SYMBOLS
}

function formatDate(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function addDays(value, days) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

function normalizeDate(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 8)
}

function classifyDisclosure(reportName) {
  const positiveHits = POSITIVE_WORDS.filter((word) => reportName.includes(word)).length
  const negativeHits = NEGATIVE_WORDS.filter((word) => reportName.includes(word)).length
  const highHits = HIGH_IMPORTANCE_WORDS.filter((word) => reportName.includes(word)).length

  let direction = 'neutral'
  if (positiveHits > negativeHits) direction = 'positive'
  if (negativeHits > positiveHits) direction = 'negative'
  if (positiveHits > 0 && negativeHits > 0) direction = 'mixed'

  const importance = highHits > 0 ? 'high' : reportName.includes('보고서') ? 'medium' : 'low'
  const expectedImpact =
    direction === 'positive'
      ? '실적, 계약, 주주환원 등 우호 가능성이 있는 공시입니다. 수치와 지속성을 원문에서 확인합니다.'
      : direction === 'negative'
        ? '주가 변동성이나 신뢰도 부담이 될 수 있는 공시입니다. 정정/리스크 원인을 먼저 확인합니다.'
        : direction === 'mixed'
          ? '긍정과 부담 키워드가 함께 있어 원문 세부 항목과 가격 반응을 같이 확인합니다.'
          : '방향성은 중립에 가깝지만 관련 종목의 공시 원문으로 확인할 가치가 있습니다.'

  return {
    direction,
    importance,
    expectedImpact,
  }
}

function toDisclosureItem(item, symbol) {
  const profile = CORP_PROFILES[symbol]
  const reportName = String(item.report_nm ?? '공시')
  const classified = classifyDisclosure(reportName)
  const rceptNo = String(item.rcept_no ?? '')

  return {
    id: `${symbol}-${rceptNo}`,
    symbol,
    corpCode: String(item.corp_code ?? profile.corpCode),
    corpName: String(item.corp_name ?? profile.name),
    stockCode: String(item.stock_code ?? symbol),
    market: profile.market,
    sector: profile.sector,
    reportName,
    submitter: String(item.flr_nm ?? ''),
    submittedAt: normalizeDate(item.rcept_dt),
    receiptNo: rceptNo,
    link: rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}` : 'https://dart.fss.or.kr',
    note: String(item.rm ?? ''),
    source: 'OpenDART',
    ...classified,
  }
}

async function requestDisclosures({ apiKey, symbol, beginDate, endDate, attempt = 0 }) {
  const profile = CORP_PROFILES[symbol]
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: profile.corpCode,
    bgn_de: beginDate,
    end_de: endDate,
    sort: 'date',
    sort_mth: 'desc',
    page_no: '1',
    page_count: '20',
  })

  const response = await fetch(`https://opendart.fss.or.kr/api/list.json?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TrackingMoney/1.0',
    },
  })

  if (response.status === 429 && attempt < 2) {
    await sleep(RETRY_DELAY_MS * (attempt + 1))
    return requestDisclosures({ apiKey, symbol, beginDate, endDate, attempt: attempt + 1 })
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`OpenDART ${response.status}: ${message.slice(0, 160)}`)
  }

  const payload = await response.json()
  if (payload.status === '013') return []
  if (payload.status !== '000') {
    throw new Error(`OpenDART ${payload.status}: ${payload.message ?? '공시 조회 실패'}`)
  }

  return (payload.list ?? []).map((item) => toDisclosureItem(item, symbol))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET 요청만 지원합니다.' })
    return
  }

  const apiKey = process.env.OPENDART_API_KEY
  if (!apiKey) {
    sendJson(res, 200, {
      configured: false,
      source: 'OpenDART',
      fetchedAt: new Date().toISOString(),
      status: 'fallback',
      items: [],
      errors: [],
      message: 'Vercel 환경변수 OPENDART_API_KEY 설정이 필요합니다.',
    })
    return
  }

  const url = new URL(req.url, `https://${req.headers.host ?? 'tracking-money.vercel.app'}`)
  const symbols = getSymbols(url.searchParams.get('symbols'))
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30), 1), 90)
  const endDate = formatDate(new Date())
  const beginDate = formatDate(addDays(new Date(), -days))
  const items = []
  const errors = []

  for (const [index, symbol] of symbols.entries()) {
    try {
      const disclosures = await requestDisclosures({ apiKey, symbol, beginDate, endDate })
      items.push(...disclosures)
    } catch (error) {
      errors.push({
        symbol,
        message: error instanceof Error ? error.message : '공시 조회 실패',
      })
    }

    if (index < symbols.length - 1) {
      await sleep(REQUEST_DELAY_MS)
    }
  }

  const dedupedItems = Array.from(new Map(items.map((item) => [item.receiptNo || item.id, item])).values())
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 40)

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
  sendJson(res, 200, {
    configured: true,
    source: 'OpenDART',
    fetchedAt: new Date().toISOString(),
    status: dedupedItems.length > 0 ? (errors.length > 0 ? 'partial' : 'ready') : 'fallback',
    symbols,
    beginDate,
    endDate,
    items: dedupedItems,
    errors,
    message:
      errors.length > 0
        ? dedupedItems.length > 0
          ? `일부 종목 공시는 수집하지 못했습니다: ${errors
              .slice(0, 3)
              .map((error) => error.symbol)
              .join(', ')}`
          : errors[0].message
        : dedupedItems.length > 0
          ? `${dedupedItems.length}개 공시 연결`
          : '최근 조회 기간에 새 공시가 없습니다.',
  })
}
