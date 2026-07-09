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
const MARKET_CONTEXT_WORDS = [
  '주가',
  '증시',
  '코스피',
  '코스닥',
  '나스닥',
  '선물',
  '실적',
  '매출',
  '영업이익',
  '가이던스',
  '수출',
  '수급',
  '투자',
  '공급',
  '수요',
  '가격',
  '마진',
  '반도체',
  'AI',
  'HBM',
  '메모리',
  '칩',
  '데이터센터',
  '전기차',
  '배터리',
  '환율',
  '금리',
  '물가',
  'CPI',
  'FOMC',
]
const NOISE_CONTEXT_WORDS = [
  '아파트',
  '주공',
  '단지',
  '입지',
  '분양',
  '건축',
  '설계',
  '랜드마크',
  '공항',
  '터미널',
  'SNS',
  '근황',
  '방송인',
  '배우',
  '예능',
  '패션',
]
const KEYWORD_CONTEXT_MAP = {
  삼성전자: ['D램', 'HBM', '파운드리', '메모리', '갤럭시', '실적', '영업이익', '반도체', 'AI', '수출', '주가'],
  SK하이닉스: ['D램', 'HBM', '메모리', '실적', '영업이익', '반도체', 'AI', '엔비디아', '주가'],
  엔비디아: ['GPU', 'AI', 'HBM', '데이터센터', '칩', '반도체', '블랙웰', '실적', '가이던스', '나스닥', '주가'],
  애플: ['아이폰', '맥', 'AI', '실적', '매출', '공급망', '반도체', '앱스토어', '주가', '나스닥'],
  테슬라: ['전기차', 'EV', '배터리', '로보택시', '자율주행', '인도량', '판매', '실적', '주가', '나스닥'],
  반도체: ['D램', 'HBM', '메모리', '파운드리', '장비', '수출', 'AI', '엔비디아', '삼성전자', 'SK하이닉스'],
  AI: ['반도체', 'GPU', '데이터센터', 'HBM', '엔비디아', '오픈AI', '클라우드', '투자', '수익화'],
  환율: ['원달러', '달러', '외국인', '수급', '수출', '금리', '물가', '코스피'],
  CPI: ['물가', '인플레이션', '금리', '연준', 'FOMC', '나스닥', '채권', '달러'],
  FOMC: ['연준', '파월', '금리', '점도표', '채권', '달러', '나스닥', '물가'],
  금리: ['연준', '채권', '국채', '물가', '인플레이션', 'FOMC', '나스닥', '성장주'],
  배터리: ['전기차', '양극재', '리튬', 'LG에너지솔루션', '테슬라', '수주', '실적', 'IRA'],
}
const REQUEST_DELAY_MS = 250
const RETRY_DELAY_MS = 800

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

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

function countHits(words, text) {
  return words.filter((word) => text.includes(word)).length
}

function evaluateNewsQuality(keyword, title, description) {
  const text = `${title} ${description}`
  const titleHit = title.includes(keyword)
  const descriptionHit = description.includes(keyword)
  const marketHits = countHits(MARKET_CONTEXT_WORDS, text)
  const keywordContextHits = countHits(KEYWORD_CONTEXT_MAP[keyword] ?? [], text)
  const importanceHits = countHits(HIGH_IMPORTANCE_WORDS, text)
  const noiseHits = countHits(NOISE_CONTEXT_WORDS, text)

  const score = clamp(
    (titleHit ? 30 : 0) +
      (descriptionHit ? 12 : 0) +
      marketHits * 7 +
      keywordContextHits * 9 +
      importanceHits * 6 -
      (marketHits + keywordContextHits === 0 ? noiseHits * 12 : noiseHits * 5),
    0,
    100,
  )

  const quality = score >= 72 ? 'high' : score >= 48 ? 'medium' : score >= 28 ? 'low' : 'noise'
  const reason =
    quality === 'high'
      ? '제목과 본문이 시장 변수와 직접 연결됩니다.'
      : quality === 'medium'
        ? '시장 관련 문맥이 확인되어 예측 재료로 참고 가능합니다.'
        : quality === 'low'
          ? '키워드는 맞지만 가격/실적/수급 연결은 약합니다.'
          : '단순 언급 가능성이 높아 예측 재료에서 제외했습니다.'

  return {
    relevanceScore: score,
    quality,
    reason,
    marketHits,
    keywordContextHits,
    noiseHits,
  }
}

function classifyNews(keyword, title, description, quality) {
  const text = `${title} ${description}`
  const positiveHits = POSITIVE_WORDS.filter((word) => text.includes(word)).length
  const negativeHits = NEGATIVE_WORDS.filter((word) => text.includes(word)).length
  const importanceHits = HIGH_IMPORTANCE_WORDS.filter((word) => text.includes(word)).length

  let direction = 'neutral'
  if (positiveHits > negativeHits) direction = 'positive'
  if (negativeHits > positiveHits) direction = 'negative'
  if (positiveHits > 0 && negativeHits > 0 && positiveHits === negativeHits) direction = 'mixed'

  const importance =
    importanceHits > 0 || keyword === 'CPI' || keyword === 'FOMC'
      ? 'high'
      : quality.quality === 'high'
        ? 'high'
        : quality.quality === 'low'
          ? 'low'
          : 'medium'
  const confidence =
    quality.quality === 'high' && positiveHits + negativeHits > 0
      ? 'high'
      : quality.quality === 'noise' || positiveHits + negativeHits === 0
        ? 'low'
        : 'medium'
  const expectedImpact =
    quality.quality === 'low'
      ? '시장 관련성은 낮아 단독 판단보다 가격 반응 확인용으로만 봅니다.'
      : direction === 'positive'
      ? '관련 종목과 국내장 심리에 우호적인 재료로 볼 수 있습니다.'
      : direction === 'negative'
        ? '장 시작 전 수급과 갭하락 리스크를 먼저 확인해야 합니다.'
        : direction === 'mixed'
          ? '긍정과 부담이 섞여 있어 실제 가격 반응 확인이 필요합니다.'
          : '방향성은 아직 중립에 가까워 후속 기사와 가격 반응을 같이 봐야 합니다.'

  return {
    direction,
    importance,
    confidence,
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

async function requestNaverNews({ keyword, display, clientId, clientSecret, attempt = 0 }) {
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

  if (response.status === 429 && attempt < 2) {
    await sleep(RETRY_DELAY_MS * (attempt + 1))
    return requestNaverNews({
      keyword,
      display,
      clientId,
      clientSecret,
      attempt: attempt + 1,
    })
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Naver News API ${response.status}: ${message}`)
  }

  return response.json()
}

async function fetchNaverNews({ keyword, display, clientId, clientSecret }) {
  const payload = await requestNaverNews({
    keyword,
    display,
    clientId,
    clientSecret,
  })

  return (payload.items ?? []).map((item, index) => {
    const title = cleanText(item.title)
    const description = cleanText(item.description)
    const link = item.originallink || item.link
    const quality = evaluateNewsQuality(keyword, title, description)
    const classified = classifyNews(keyword, title, description, quality)

    return {
      id: `${keyword}-${item.pubDate ?? index}-${link}`,
      keyword,
      title,
      source: getSource(link),
      link,
      description,
      publishedAt: item.pubDate,
      relevanceScore: quality.relevanceScore,
      quality: quality.quality,
      qualityReason: quality.reason,
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
      fetchedAt: new Date().toISOString(),
      items: [],
      message: 'Vercel 환경변수 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 설정이 필요합니다.',
    })
    return
  }

  const url = new URL(req.url, `https://${req.headers.host ?? 'tracking-money.vercel.app'}`)
  const keywords = getKeywords(url.searchParams.get('keywords'))
  const display = Math.min(Math.max(Number(url.searchParams.get('display') ?? 3), 1), 5)

  try {
    const results = []
    const errors = []

    for (const [index, keyword] of keywords.entries()) {
      try {
        const items = await fetchNaverNews({
          keyword,
          display,
          clientId,
          clientSecret,
        })
        results.push(...items)
      } catch (error) {
        errors.push({
          keyword,
          message: error instanceof Error ? error.message : '수집 실패',
        })
      }

      if (index < keywords.length - 1) {
        await sleep(REQUEST_DELAY_MS)
      }
    }

    const seenLinks = new Set()
    const seenTitles = new Set()
    const rawCount = results.length
    const qualityFilteredCount = results.filter((item) => item.quality === 'noise').length
    const items = results
      .filter((item) => {
        if (seenLinks.has(item.link)) return false
        if (item.quality === 'noise') return false
        seenLinks.add(item.link)
        const titleKey = `${item.source}:${item.title.replace(/\s+/g, ' ').trim()}`
        if (seenTitles.has(titleKey)) return false
        seenTitles.add(titleKey)
        return true
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 36)

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900')
    sendJson(res, 200, {
      configured: true,
      fetchedAt: new Date().toISOString(),
      keywords,
      rawCount,
      qualityFilteredCount,
      qualityGate: 'market-relevance-v1',
      items,
      message:
        errors.length > 0
          ? items.length > 0
            ? `일부 키워드는 네이버 속도 제한으로 다음 새로고침에서 다시 수집합니다: ${errors
                .slice(0, 3)
                .map((error) => error.keyword)
                .join(', ')}`
            : errors[0].message
          : undefined,
    })
  } catch (error) {
    sendJson(res, 502, {
      configured: true,
      fetchedAt: new Date().toISOString(),
      items: [],
      message: error instanceof Error ? error.message : '네이버 뉴스 API 호출에 실패했습니다.',
    })
  }
}
