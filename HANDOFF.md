# Alfred — Project Handoff Document
**Last updated:** April 7, 2026  
**Live URL:** https://alfred-navy-xi.vercel.app  
**GitHub:** https://github.com/SilverbackWeb/Alfred  
**Telegram Bot:** @Alfred_AlphaBot

---

## What Alfred Is

Alfred is a personal AI assistant with two interfaces:
1. **Web Dashboard** — Task management board at alfred-navy-xi.vercel.app
2. **Telegram Bot** — @Alfred_AlphaBot — primary interface for all AI interactions

Built with: Next.js 16.2.1, React 19, PostgreSQL (Neon), Prisma ORM, OpenAI gpt-4o-mini (via Vercel AI SDK), deployed on Vercel.

---

## Architecture

```
Alfred/
├── src/
│   ├── app/
│   │   ├── page.tsx                          ← Dashboard homepage with Alfred header + stats
│   │   ├── layout.tsx                        ← App shell, metadata
│   │   ├── actions.ts                        ← Server actions (delete/move/update tasks)
│   │   ├── globals.css                       ← Tailwind styles
│   │   └── api/
│   │       ├── telegram/route.ts             ← MAIN BOT BRAIN — all AI logic lives here
│   │       └── auth/google/
│   │           ├── route.ts                  ← GET /api/auth/google (OAuth start)
│   │           └── callback/route.ts         ← GET /api/auth/google/callback (token capture)
│   ├── components/
│   │   └── dashboard-client.tsx              ← Full dashboard UI (Focus/Vault/Completed/Modal)
│   └── lib/
│       ├── prisma.ts                         ← Prisma singleton
│       ├── github.ts                         ← GitHub API (list repos, issues, notifications)
│       ├── google.ts                         ← Gmail, Calendar, Google Docs
│       ├── slack.ts                          ← Slack messaging
│       └── gohighlevel.ts                    ← GHL CRM (contacts, pipeline, SMS, opportunities)
├── prisma/
│   └── schema.prisma                         ← Database schema
├── public/
│   └── alfred.png                            ← Alfred avatar image
├── .env                                      ← Local env vars (never committed)
├── vercel.json                               ← Build config
└── setup-webhook.js                          ← Run locally to register Telegram webhook
```

---

## Database Schema

### User
- `id`, `telegramId` (unique), `name`
- `lastDraftTo`, `lastDraftSubject`, `lastDraftBody` — stores last email draft for "send it" confirmation
- `lastPipeline` — JSON string of last GHL pipeline results shown (for follow-up commands)

### Task
- `id`, `title`, `description`, `status`, `priority`, `category`
- `status` values: `TODO`, `IN_PROGRESS`, `AGENT_WORKING`, `DONE`, `BACKLOG`
- `priority` values: `LOW`, `MEDIUM`, `HIGH`
- `category` values: `PERSONAL`, `BUSINESS`, `IDEA`
- `dueDate`, `reminderAt`, `result` (Alfred's output when he executes a task)
- Relations: `userId` → User

### Idea
- `id`, `title`, `description`, `notes`, `userId`

---

## Dashboard Features

- **Focus Mode** — 3 columns: To Do, In Progress, Agent Tasks
- **The Vault** — 3 columns: Personal, Business, Ideas (BACKLOG status tasks)
- **Completed** — toggle button top-right, shows all DONE tasks
- **Task Detail Modal** — click any card to see full description, meta, Alfred's Output section
- **Ask Alfred button** — deep-links to @Alfred_AlphaBot in Telegram
- **Header** — Alfred avatar with spinning rings, live stats (Active/Done/In Vault), online indicator

---

## Telegram Bot Capabilities

### Task Management
- Create tasks (auto-categorized: PERSONAL/BUSINESS/IDEA, priority LOW/MEDIUM/HIGH)
- Move tasks to backlog/vault
- Search vault by keyword
- List all vault tasks
- Update task priority, due date, status
- Mark tasks done

### Agent Execution ("What can you take off my plate?")
- Alfred reviews TODO tasks and classifies what he can handle
- **draft** — writes full content, stores in task `result` field
- **research** — AI summary, stores in task `result` field
- **slack** — sends Slack message, stores confirmation

### Gmail
- `draftEmail` — creates Gmail draft AND shows full email preview in Telegram
- `sendLastDraft` — sends the last drafted email (triggered by "send it")
- **Hard-coded confirmation intercept** — words like "yes/send it/go ahead" bypass AI and directly call sendEmail using saved draft data
- `searchEmails` — Gmail search syntax

### Google Calendar
- `getCalendar` — upcoming events (no links, clean list)
- `createCalendarEvent` — creates event, returns confirmation

### Google Docs
- `createGoogleDoc` — creates doc via Docs API, returns edit link

### GoHighLevel CRM
- `searchCRMContacts` — search by name/email/phone
- `createCRMContact` — add new lead
- `updateCRMContact` — update contact fields
- `getPipeline` — list opportunities (saves results to `lastPipeline` for follow-up)
- `updateOpportunity` — change status (open/won/lost/abandoned), value, name
- `sendSMSToContact` — send SMS via GHL Twilio

### GitHub
- `listGitHubRepos` — list all repos
- `searchGitHubRepos` — search repos
- `getGitHubIssues` — open issues for a repo
- `getGitHubActivity` — recent notifications

### Slack
- `sendSlackMessage` — send to any channel
- `listSlackChannels` — list available channels

### PDF Processing
- Send a PDF directly in Telegram
- Alfred downloads, extracts text, AI categorizes into tasks, saves to Vault

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `TELEGRAM_TOKEN` | `8605062570:AAEX-...` |
| `OPENAI_API_KEY` | OpenAI API key |
| `GITHUB_TOKEN` | GitHub personal access token |
| `SLACK_BOT_TOKEN` | `xoxb-5153026916566-...` (silverbackweb group workspace) |
| `GOOGLE_CLIENT_ID` | Found in Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Found in Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_REDIRECT_URI` | `https://alfred-navy-xi.vercel.app/api/auth/google/callback` |
| `GOOGLE_REFRESH_TOKEN` | Captured via OAuth flow — permanent token |
| `GHL_API_KEY` | `pit-a3ba72c0-75c6-4ea4-846a-155b2df2c750` (Private Integration Token) |
| `GHL_LOCATION_ID` | `B6f7xvBmMEv4AbDVHB6H` |

All variables must be set in both `.env` (local) and Vercel dashboard (production).

---

## Known Limitations & Current Workarounds

### Memory Problem (IN PROGRESS — next task)
Alfred has **no conversation memory between messages**. Every Telegram message is a fresh context with no history. This causes:
- "Send it" failing after a draft (partially fixed with hard-coded intercept + `lastDraft` DB fields)
- "Move X to lost" failing after pipeline shown (partially fixed with `lastPipeline` DB field)
- General context loss for anything said more than one message ago

**These are band-aids. The real fix is being built next.**

### GHL API Notes
- Uses v2 API at `services.leadconnectorhq.com` (NOT the old `rest.gohighlevel.com/v1`)
- Requires `Version: 2021-07-28` header
- API key format is `pit-xxx` (Private Integration Token)
- SMS sending via GHL's conversation API (not direct Twilio)

---

## What We Are Building Next: Conversation Memory

**The fix:** Store every message exchange in the database and inject the last 20 messages into every OpenAI call as conversation history.

### Implementation Plan

**1. Add `Message` model to Prisma schema:**
```prisma
model Message {
  id        String   @id @default(uuid())
  role      String   // "user" or "assistant"
  content   String
  createdAt DateTime @default(now())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**2. In `src/app/api/telegram/route.ts`:**
- Before calling OpenAI: load last 20 messages for this user from DB
- Pass them as `messages` array to `generateText` (in addition to system prompt)
- After getting Alfred's reply: save both the user message and Alfred's reply to DB

**3. Result:** Alfred will remember everything said in the conversation — pipeline results, email drafts, contact names, context from several messages back. All the band-aid fixes (lastDraft, lastPipeline) become unnecessary but can stay as fast-path shortcuts.

**4. Files to change:**
- `prisma/schema.prisma` — add Message model
- `src/app/api/telegram/route.ts` — load history, pass to AI, save after each exchange

This is a clean ~50 line change that fundamentally transforms Alfred from a stateless bot into a real assistant.

---

## Setup / Re-deployment Notes

### If Telegram webhook breaks:
```bash
node setup-webhook.js
```

### If Google OAuth token expires (it shouldn't — refresh tokens are permanent):
Visit `https://alfred-navy-xi.vercel.app/api/auth/google` → sign in → copy new refresh token → update `GOOGLE_REFRESH_TOKEN` in Vercel → redeploy.

### Local development:
```bash
cd Alfred
npm run dev
# In separate terminal:
node poll-telegram.js  # polls Telegram locally instead of webhook
```
