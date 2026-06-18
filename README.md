# Scheduler

An AI-powered calendar assistant. Speak, type, or upload an image — Claude figures out what to schedule and proposes it before writing anything to Google Calendar. Includes a todo list sidebar, a Calendly-style public booking page, and full mobile support.

**Live:** https://swaraag-scheduler.vercel.app

---

## Features

- **Natural language scheduling** — "dentist Friday at 2pm" or "block 3 hours Thursday for studying" gets parsed by Claude and proposed as an editable event card before anything hits your calendar
- **Voice input** — tap the mic and speak; transcript streams live into the input field
- **Image input** — upload a screenshot of a schedule, flyer, or syllabus and Claude extracts the events
- **Todo list** — Claude routes input between calendar and todos automatically; drag todos onto the time grid to schedule them
- **Smart routing** — adding, deleting, and todo-ing can all happen in a single input ("cancel dentist, add gym tomorrow, remind me to pack")
- **Recurring events** — say "every Monday" and Claude generates the correct RRULE
- **Multi-calendar** — works across all your Google Calendars with per-calendar toggles
- **Public booking page** — share a link for others to book time without signing in (Calendly-style)
- **Mobile-first** — 3-day view on mobile, swipeable drawer for todos, touch-friendly drag and resize
- **Scheduling memory** — Claude remembers your preferences (e.g. "don't schedule before 9am") across sessions

## How It Works

1. Sign in with Google — the app gets read/write access to your calendar
2. Type, speak, or upload an image describing what you want
3. Claude proposes event cards you can edit inline (title, time, location, color, repeat, etc.)
4. Hit **Confirm** — events are written to Google Calendar instantly

Deletions work the same way: say "remove my 3pm meeting" and Claude finds the matching event and shows a deletion card for you to confirm.

## Stack

- **Frontend:** Vanilla JS, no frameworks, no bundler
- **Backend:** Vercel serverless functions (Node.js ESM)
- **AI:** Anthropic Claude — Haiku for scheduling, Sonnet for routing
- **Calendar:** Google Calendar REST API v3
- **Auth:** Server-side OAuth 2.0 (works on Safari iOS)
- **Email:** Resend (booking confirmations + access requests)
- **Hosting:** Vercel

## Local Development

### Prerequisites

- [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`)
- A Google Cloud project with Calendar API enabled and OAuth 2.0 credentials
- An Anthropic API key
- A Resend API key (for the booking page emails)

### Setup

1. Clone the repo and link to Vercel:
   ```bash
   git clone https://github.com/your-username/scheduler.git
   cd scheduler
   vercel link
   ```

2. Create `.env.local` with the following variables:
   ```
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REFRESH_TOKEN=
   GOOGLE_CALENDAR_ID=primary
   OAUTH_REDIRECT_URI=http://localhost:3000/api/callback
   ANTHROPIC_API_KEY=
   OWNER_NAME=Your Name
   OWNER_EMAIL=you@gmail.com
   RESEND_API_KEY=
   BLOCKED_EMAILS=
   ```

3. Run locally:
   ```bash
   vercel dev
   ```
   Opens at `http://localhost:3000`. Do **not** use Live Server — the API functions won't work without Vercel's dev server.

### Google Cloud Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google Calendar API**
3. Create OAuth 2.0 credentials (Web application type)
4. Add authorized redirect URIs:
   - `http://localhost:3000/api/callback` (local)
   - `https://your-app.vercel.app/api/callback` (production)
5. Set the OAuth consent screen to **Production** (so any Google account can sign in without being whitelisted)
6. Generate a refresh token for the owner's calendar and set it as `GOOGLE_REFRESH_TOKEN`

## Deployment

Push to `main` → Vercel auto-deploys. No build step.

```bash
git push origin main
```

For production env vars, set them in the Vercel dashboard. **Do not run `vercel env pull`** — it overwrites `.env.local` and strips manually added variables.

## Access Control

By default, anyone with a Google account can sign in. To block specific users, add their emails (comma-separated) to the `BLOCKED_EMAILS` environment variable.

## Booking Page

The public booking page lives at `/share.html`. Visitors can see your availability (no event titles — just busy/free blocks) and request a meeting time. Claude finds a free slot, the visitor confirms, and both parties get a confirmation email. No sign-in required for visitors.
