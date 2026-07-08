# Tracking Money

개인 보유종목, 관심종목, 미국 선행 지표, 뉴스 이슈, 캘린더를 한 화면에서 보는 투자 대시보드입니다.

## 주요 기능

- 내일 국내장 방향점수
- 보유종목과 관심종목 영향도
- NQ 선물, SOX, VIX, 달러/원, 미국 금리 등 선행 지표
- Yahoo Finance chart 기반 무료 시세 프록시
- 네이버 뉴스 API 기반 키워드 뉴스 피드
- 실적, 매크로, 정책 이벤트 캘린더

## 실시간 데이터 연결

앱은 Vercel 서버 함수를 통해 외부 데이터를 가져옵니다. 브라우저가 직접 외부 API를 호출하지 않습니다.

```text
/api/news    네이버 뉴스 API 프록시
/api/quotes  Yahoo Finance chart 기반 시세 프록시
```

`/api/quotes`는 아래 기본 심볼을 수집합니다.

```text
005930.KS  삼성전자
000660.KS  SK하이닉스
035420.KS  NAVER
373220.KS  LG에너지솔루션
AAPL       Apple
TSLA       Tesla
NVDA       NVIDIA
NQ=F       나스닥100 선물
ES=F       S&P500 선물
^SOX       필라델피아 반도체지수
^VIX       변동성 지수
DX-Y.NYB   달러 인덱스
^TNX       미국 10년물 금리
KRW=X      달러/원
```

시세 수집이 실패하면 기존 샘플 데이터로 자동 fallback됩니다.

## 네이버 뉴스 API 환경변수

Vercel 프로젝트의 `Settings > Environment Variables`에 아래 값을 추가합니다.

```text
NAVER_CLIENT_ID=네이버_개발자센터_Client_ID
NAVER_CLIENT_SECRET=네이버_개발자센터_Client_Secret
```

로컬에서 Vercel 서버 함수까지 테스트할 때는 `.env.local`에 같은 이름으로 넣고 Vercel CLI로 실행합니다. `.env.local`은 커밋하지 않습니다.

## 네이버 개발자센터 WEB 설정

네이버 개발자센터 애플리케이션의 `API 설정 > WEB 설정`에는 아래 주소를 등록합니다.

```text
https://tracking-money-beta.vercel.app
http://127.0.0.1
```

## 개발 명령어

```bash
npm run dev
npm run build
npm run lint
```
