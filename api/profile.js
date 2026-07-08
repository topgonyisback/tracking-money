import { timingSafeEqual } from 'node:crypto'

const PROFILE_KEY = process.env.PROFILE_SYNC_RECORD_KEY || 'tracking-money:profile:v1'
const MAX_BODY_BYTES = 160_000

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function isConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN && process.env.PROFILE_SYNC_KEY)
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function authorize(req) {
  const expectedKey = process.env.PROFILE_SYNC_KEY
  const providedKey = req.headers['x-sync-key']
  if (!expectedKey || typeof providedKey !== 'string') return false
  return safeEquals(providedKey, expectedKey)
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = ''

    req.on('data', (chunk) => {
      rawBody += chunk
      if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
        reject(new Error('동기화 데이터가 너무 큽니다.'))
        req.destroy()
      }
    })

    req.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {})
      } catch {
        reject(new Error('JSON 요청 본문을 읽지 못했습니다.'))
      }
    })

    req.on('error', reject)
  })
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateProfileData(data) {
  if (!isObject(data)) return false
  if (!Array.isArray(data.holdings)) return false
  if (!Array.isArray(data.watchlist)) return false
  if (!Array.isArray(data.newsKeywords)) return false
  if (!isObject(data.journal)) return false
  return true
}

async function runRedisCommand(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error ?? `프로필 저장소 응답 오류 ${response.status}`)
  }
  if (payload?.error) {
    throw new Error(payload.error)
  }

  return payload?.result ?? null
}

async function loadProfile() {
  const rawValue = await runRedisCommand(['GET', PROFILE_KEY])
  if (!rawValue) return null

  const profile = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue
  if (!isObject(profile) || !validateProfileData(profile.data)) return null
  return profile
}

async function saveProfile(data) {
  const profile = {
    version: 1,
    source: 'Tracking Money profile sync',
    updatedAt: new Date().toISOString(),
    data,
  }

  await runRedisCommand(['SET', PROFILE_KEY, JSON.stringify(profile)])
  return profile
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host ?? 'tracking-money.vercel.app'}`)

  if (req.method === 'GET' && url.searchParams.get('status') === '1') {
    sendJson(res, 200, {
      configured: isConfigured(),
      source: 'Tracking Money profile sync',
      storage: 'Upstash Redis REST',
      message: isConfigured()
        ? '서버 동기화 저장소가 설정되어 있습니다.'
        : 'KV_REST_API_URL, KV_REST_API_TOKEN, PROFILE_SYNC_KEY 환경변수 설정이 필요합니다.',
    })
    return
  }

  if (!['GET', 'PUT'].includes(req.method)) {
    sendJson(res, 405, { configured: isConfigured(), message: 'GET 또는 PUT 요청만 지원합니다.' })
    return
  }

  if (!isConfigured()) {
    sendJson(res, 200, {
      configured: false,
      status: 'missing',
      data: null,
      message: '서버 동기화를 사용하려면 Vercel 환경변수 KV_REST_API_URL, KV_REST_API_TOKEN, PROFILE_SYNC_KEY를 추가해야 합니다.',
    })
    return
  }

  if (!authorize(req)) {
    sendJson(res, 401, {
      configured: true,
      status: 'unauthorized',
      data: null,
      message: '동기화 키가 맞지 않습니다.',
    })
    return
  }

  try {
    if (req.method === 'GET') {
      const profile = await loadProfile()
      sendJson(res, 200, {
        configured: true,
        status: profile ? 'ready' : 'empty',
        data: profile?.data ?? null,
        updatedAt: profile?.updatedAt ?? null,
        message: profile ? '서버 프로필을 불러왔습니다.' : '아직 서버에 저장된 프로필이 없습니다.',
      })
      return
    }

    const body = await parseBody(req)
    const data = isObject(body) && isObject(body.data) ? body.data : null
    if (!validateProfileData(data)) {
      sendJson(res, 400, {
        configured: true,
        status: 'invalid',
        message: '저장할 프로필 형식이 맞지 않습니다.',
      })
      return
    }

    const profile = await saveProfile(data)
    sendJson(res, 200, {
      configured: true,
      status: 'ready',
      data: profile.data,
      updatedAt: profile.updatedAt,
      message: '현재 프로필을 서버에 저장했습니다.',
    })
  } catch (error) {
    sendJson(res, 502, {
      configured: true,
      status: 'error',
      data: null,
      message: error instanceof Error ? error.message : '서버 동기화 처리 중 오류가 발생했습니다.',
    })
  }
}
