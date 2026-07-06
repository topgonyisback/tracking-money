# Tracking Money Build Plan

## Product Direction

Tracking Money is a personal market radar for reading how today's issues, global indexes, futures, FX, rates, and news can affect tomorrow's Korean market and the user's holdings/watchlist.

The first screen should answer four questions:

1. What is tomorrow's Korea market bias?
2. Which indicators are driving that bias?
3. Which of my holdings or watchlist names are affected?
4. What should I watch before and after the market opens?

## Build Order

### 1. Project Setup

- Create the React project.
- Use TypeScript from the start.
- Keep the app structure simple enough for MVP iteration.
- Start with mock data before live APIs.

### 2. Tailwind CSS and shadcn/ui Setup

- Install Tailwind CSS.
- Add shadcn/ui-style local components.
- Add Radix primitives for accessible interactions.
- Add lucide-react for icons.
- Add charting libraries for market visuals.
- Define a dark-first visual system.

### 3. Data Model

Core entities:

- `MarketIndicator`
- `BiasScore`
- `Holding`
- `WatchItem`
- `NewsIssue`
- `CalendarEvent`
- `ActionMemo`

These models become the contract between frontend mock data, backend API, DB tables, and future workers.

### 4. Mock Data

- Create realistic sample data for indicators, issues, holdings, watchlist, calendar, and notes.
- Keep mock data shaped exactly like the future API response.
- Use mock data to finish the dashboard before connecting external APIs.

### 5. Main Dashboard UI

- Build the app shell.
- Add left sidebar.
- Add top status bar.
- Add dashboard blocks:
  - Korea market bias
  - Today's key issues
  - US leading indicators
  - Portfolio impact
  - Watchlist triggers
  - News radar
  - Event calendar
  - Action memo

### 6. Backend API

- Add CRUD APIs for holdings and watchlist.
- Add read APIs for indicators, issues, calendar, and bias score.
- Start with local storage or SQLite-backed endpoints.

### 7. Database

- Start with SQLite for local-first development.
- Move to PostgreSQL when deployment and multi-device access matter.
- Add migration tooling before external data ingestion grows.

### 8. Data Workers

- Poll market data on a schedule.
- Poll news and disclosure sources separately.
- Store raw source payloads and normalized records.
- Keep worker failures isolated from the dashboard.

### 9. Analysis Engine

- Deduplicate news.
- Map issues to symbols, sectors, and Korea market relevance.
- Score direction, importance, and confidence.
- Use AI for summaries and reasoning after deterministic rules exist.

### 10. Realtime Updates

- Start with polling.
- Move price and issue streams to Server-Sent Events or WebSocket later.
- Show update timestamps and stale-data states.

### 11. Infra and Deployment

- Manage API keys with `.env`.
- Add local backup for user data.
- Deploy frontend separately from backend when needed.
- Candidate setup:
  - Frontend: Vercel
  - Backend/worker: Railway, Fly.io, or a small VPS
  - DB: Supabase Postgres or managed PostgreSQL

## MVP Acceptance

The MVP is useful when:

- The user can open one dashboard and see tomorrow's Korean market bias.
- The bias has visible supporting indicators and issues.
- Holdings/watchlist show impact and trigger states.
- Calendar events and action memos are visible on the same screen.
- The UI works with mock data and can later swap to API data without reshaping the frontend.
