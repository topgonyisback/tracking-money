const DEFAULT_KEYWORDS = [
  '삼성전자',
  'SK하이닉스',
  '엔비디아',
  '애플',
  '테슬라',
  '반도체',
  'AI',
  '환율',
  'CPI',
  'FOMC',
  '금리',
  '배터리',
]

const SYMBOL_MAP = {
  삼성전자: ['005930'],
  SK하이닉스: ['000660'],
  엔비디아: ['NVDA'],
  애플: ['AAPL'],
  테슬라: ['TSLA'],
  반도체: ['SOX', '005930', '000660', 'NVDA'],
  AI: ['NVDA', 'SOX', '005930', '000660'],
  환율: ['USD/KRW', 'KOSPI'],
  CPI: ['NQ=F', 'US10Y', 'USD/KRW'],
  FOMC: ['NQ=F', 'US10Y', 'USD/KRW'],
  금리: ['US10Y', 'NQ=F', 'KOSPI'],
  배터리: ['373220', 'TSLA'],
}

const SECTOR_MAP = {
  삼성전자: ['반도체', '코스피'],
  SK하이닉스: ['반도체', 'AI'],
  엔비디아: ['AI', '반도체'],
  애플: ['하드웨어', '공급망'],
  테슬라: ['전기차', '배터리'],
  반도체: ['반도체'],
  AI: ['AI'],
  환율: ['환율', '매크로'],
  CPI: ['물가', '매크로'],
  FOMC: ['금리', '매크로'],
  금리: ['금리', '매크로'],
  배터리: ['배터리'],
}

const POSITIVE_WORDS = [
  '강세',
  '상승',
  '반등',
  '호조',
  '개선',
  '확대',
  '수혜',
  '최대',
  '성장',
  '낙관',
  '기대',
  '돌파',
  '실적',
  '흑자',
]

const NEGATIVE_WORDS = [
  '약세',
  '하락',
  '급락',
  '부진',
  '악화',
  '축소',
  '우려',
  '리스크',
  '부담',
  '적자',
  '경고',
  '압박',
  '침체',
  '인하',
  '인상',
]

const HIGH_IMPORTANCE_WORDS = ['실적', 'CPI', 'FOMC', '금리', '환율', '관세', '규제', '가이던스', '서프라이즈']

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function cleanText(value) {
  return decodeEntities(String(value ?? '').replace(/<\/?[^>]+(>|$)/g, '')).trim()
}

function getSource(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return '네이버 뉴스'
  }
}

function classifyNews(keyword, title, description) {
  const text = `${title} ${description}`
  const positiveHits = POSITIVE_WORDS.filter((word) => text.includes(word)).length
  const negativeHits = NEGATIVE_WORDS.filter((word) => text.includes(word)).length
  const importanceHits = HIGH_IMPORTANCE_WORDS.filter((word) => text.includes(word)).length

  let direction = 'neutral'
  if (positiveHits > negativeHits) direction = 'positive'
  if (negativeHits > positiveHits) direction = 'negative'
  if (positiveHits > 0 && negativeHits > 0 && positiveHits === negativeHits) direction = 'mixed'

  const importance = importanceHits > 0 || keyword === 'CPI' || keyword === 'FOMC' ? 'high' : 'medium'
  const expectedImpact =
    direction === 'positive'
      ? '관련 종목과 국내장 심리에 우호적인 재료로 볼 수 있습니다.'
      : direction === 'negative'
        ? '장 시작 전 수급과 갭하락 리스크를 먼저 확인해야 합니다.'
        : direction === 'mixed'
          ? '긍정과 부담이 섞여 있어 실제 가격 반응 확인이 필요합니다.'
          : '방향성은 아직 중립에 가까워 후속 기사와 가격 반응을 같이 봐야 합니다.'

  return {
    direction,
    importance,
    confidence: positiveHits + negativeHits > 0 ? 'medium' : 'low',
    relatedSymbols: SYMBOL_MAP[keyword] ?? [],
    sectors: SECTOR_MAP[keyword] ?? [keyword],
    expectedImpact,
  }
}

function getKeywords(rawKeywords) {
  if (!rawKeywords) return DEFAULT_KEYWORDS

  const keywords = rawKeywords
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 12)

  return keywords.length > 0 ? keywords : DEFAULT_KEYWORDS
}

async function fetchNaverNews({ keyword, display, clientId, clientSecret }) {
  const params = new URLSearchParams({
    query: keyword,
    display: String(display),
    sort: 'date',
  })
  const response = await fetch(`https://openapi.naver.com/v1/search/news.json?${params.toString()}`, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Naver News API ${response.status}: ${message}`)
  }

  const payload = await response.json()
  return (payload.items ?? []).map((item, index) => {
    const title = cleanText(item.title)
    const description = cleanText(item.description)
    const link = item.originallink || item.link
    const classified = classifyNews(keyword, title, description)

    return {
      id: `${keyword}-${item.pubDate ?? index}-${link}`,
      keyword,
      title,
      source: getSource(link),
      link,
      description,
      publishedAt: item.pubDate,
      ...classified,
    }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET 요청만 지원합니다.' })
    return
  }

  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    sendJson(res, 200, {
      configured: false,
      items: [],
      message: 'Vercel 환경변수 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 설정이 필요합니다.',
    })
    return
  }

  const url = new URL(req.url, `https://${req.headers.host ?? 'tracking-money.vercel.app'}`)
  const keywords = getKeywords(url.searchParams.get('keywords'))
  const display = Math.min(Math.max(Number(url.searchParams.get('display') ?? 3), 1), 5)

  try {
    const results = await Promise.all(
      keywords.map((keyword) =>
        fetchNaverNews({
          keyword,
          display,
          clientId,
          clientSecret,
        }),
      ),
    )

    const seenLinks = new Set()
    const items = results
      .flat()
      .filter((item) => {
        if (seenLinks.has(item.link)) return false
        seenLinks.add(item.link)
        return true
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 36)

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900')
    sendJson(res, 200, {
      configured: true,
      fetchedAt: new Date().toISOString(),
      keywords,
      items,
    })
  } catch (error) {
    sendJson(res, 502, {
      configured: true,
      items: [],
      message: error instanceof Error ? error.message : '네이버 뉴스 API 호출에 실패했습니다.',
    })
  }
}
