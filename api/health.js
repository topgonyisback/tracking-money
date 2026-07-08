function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function isConfigured(...keys) {
  return keys.every((key) => Boolean(process.env[key]))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET 요청만 지원합니다.' })
    return
  }

  const naverConfigured = isConfigured('NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET')
  const openDartConfigured = isConfigured('OPENDART_API_KEY')
  const profileSyncConfigured = isConfigured('KV_REST_API_URL', 'KV_REST_API_TOKEN', 'PROFILE_SYNC_KEY')
  const services = [
    {
      id: 'quotes',
      name: '시세와 선행지표',
      status: 'ready',
      configured: true,
      source: 'Yahoo Finance chart',
      requiredEnv: [],
      cadence: '서버 60초 캐시, 화면 120초 갱신',
      coverage: ['보유/관심종목', 'NQ=F', 'SOX', 'VIX', 'DXY', 'US10Y', 'USD/KRW'],
      summary: '무료 시세 프록시가 서버 함수에서 동작합니다.',
      nextAction: 'Yahoo 응답 실패나 속도 제한이 생기면 화면은 샘플 데이터로 fallback됩니다.',
    },
    {
      id: 'news',
      name: '뉴스 이슈',
      status: naverConfigured ? 'ready' : 'missing',
      configured: naverConfigured,
      source: 'Naver News Open API',
      requiredEnv: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
      cadence: '서버 5분 캐시, 화면 10분 갱신',
      coverage: ['삼성전자', 'SK하이닉스', '엔비디아', '애플', '테슬라', '반도체', 'AI', '환율', 'CPI', 'FOMC', '금리', '배터리'],
      summary: naverConfigured ? '네이버 뉴스 키가 서버 환경변수에 설정되어 있습니다.' : '네이버 뉴스 키가 설정되지 않았습니다.',
      nextAction: naverConfigured ? '키워드별 최신 뉴스와 영향도 분류를 사용할 수 있습니다.' : 'Vercel 환경변수에 NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET을 추가해야 합니다.',
    },
    {
      id: 'calendar',
      name: '이벤트 캘린더',
      status: 'ready',
      configured: true,
      source: 'Tracking Money calendar rules',
      requiredEnv: [],
      cadence: '서버 1시간 캐시, 화면 1시간 갱신',
      coverage: ['국내장 개장 전 점검', 'CPI', '고용', 'FOMC', '옵션만기', '추정 실적 구간'],
      summary: '공개 API 키 없이 규칙 기반 이벤트를 생성합니다.',
      nextAction: 'estimated 일정은 회사 IR 또는 공식 캘린더로 재확인하세요.',
    },
    {
      id: 'storage',
      name: '개인 데이터 저장',
      status: 'local',
      configured: true,
      source: 'Browser localStorage + JSON backup',
      requiredEnv: [],
      cadence: '입력 즉시 저장',
      coverage: ['보유종목', '관심종목', '뉴스 키워드', '알림 규칙', '알림 기록', '투자노트'],
      summary: '개인 입력 데이터는 현재 브라우저에 저장됩니다.',
      nextAction: '다른 기기와 동기화하려면 서버 동기화 환경변수를 설정합니다.',
    },
    {
      id: 'profile-sync',
      name: '서버 프로필 동기화',
      status: profileSyncConfigured ? 'ready' : 'missing',
      configured: profileSyncConfigured,
      source: 'Upstash Redis REST',
      requiredEnv: ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'PROFILE_SYNC_KEY'],
      cadence: '사용자가 저장/불러오기 실행',
      coverage: ['보유종목', '관심종목', '뉴스 키워드', '알림 규칙', '알림 기록', '투자노트'],
      summary: profileSyncConfigured ? '서버 프로필 동기화 저장소가 설정되어 있습니다.' : '서버 프로필 동기화 저장소가 설정되지 않았습니다.',
      nextAction: profileSyncConfigured
        ? '설정 화면에서 동기화 키를 입력해 현재 프로필을 저장하거나 불러올 수 있습니다.'
        : 'Vercel 환경변수 KV_REST_API_URL, KV_REST_API_TOKEN, PROFILE_SYNC_KEY를 추가하면 다른 기기와 동기화할 수 있습니다.',
    },
    {
      id: 'disclosure',
      name: '공시/실적 원문',
      status: openDartConfigured ? 'ready' : 'missing',
      configured: openDartConfigured,
      source: 'OpenDART',
      requiredEnv: ['OPENDART_API_KEY'],
      cadence: '서버 5분 캐시, 화면 15분 갱신',
      coverage: ['국내 상장사 공시', '실적 정정', '잠정실적', '주요사항보고서'],
      summary: openDartConfigured ? 'OpenDART 키가 서버 환경변수에 설정되어 있습니다.' : 'OpenDART 키가 설정되지 않았습니다.',
      nextAction: openDartConfigured ? '보유/관심 국내 종목의 최근 공시를 확인할 수 있습니다.' : 'Vercel 환경변수에 OPENDART_API_KEY를 추가하면 공시 원문이 연결됩니다.',
    },
  ]

  const blockingServices = services.filter((service) => service.status === 'missing')

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
  sendJson(res, 200, {
    configured: blockingServices.length === 0,
    source: 'Tracking Money health',
    environment: process.env.VERCEL_ENV ?? 'local',
    fetchedAt: new Date().toISOString(),
    status: blockingServices.length > 0 ? 'partial' : 'ready',
    services,
    message:
      blockingServices.length > 0
        ? `${blockingServices.map((service) => service.name).join(', ')} 설정을 확인해야 합니다.`
        : '실데이터 연결 상태를 확인했습니다.',
  })
}
