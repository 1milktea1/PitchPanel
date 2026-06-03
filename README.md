# PitchPanel AI

PitchPanel AI is a web-based startup pitch simulator powered by the AssemblyAI Voice Agent API. It gives founders a fast, dramatic, Shark Tank-style practice session: choose three AI investors, deliver a 30-second pitch, answer targeted questions, and receive a final verdict card with scores and feedback.

The goal is not just to make a flashy voice demo. PitchPanel AI helps founders pressure-test the clarity of their startup idea, business model, technical moat, customer understanding, and presentation style in a compressed, entertaining format.

## Why Use It

Founders often practice pitches in front of friendly people who avoid the hard questions. PitchPanel AI creates a sharper practice loop:

- It forces a concise 30-second opening pitch.
- It asks investor-style questions based on the pitch.
- It evaluates both the startup and the founder's delivery.
- It surfaces likely failure modes, biggest risks, and next steps.
- It uses voice, interruption, turn detection, and tool calling through one managed API.

The experience is useful for pitch prep, startup workshops, hackathon demos, founder coaching, and anyone who wants a quick reality check before talking to real investors or customers.

## How It Works

PitchPanel AI uses the AssemblyAI Voice Agent API rather than separate STT, LLM, and TTS services. The browser connects to AssemblyAI with a temporary token minted by the local Node server, so the real API key never appears in frontend code.

Flow:

1. The user selects exactly three judges.
2. The server mints a temporary AssemblyAI Voice Agent token.
3. The browser opens a WebSocket connection to the Voice Agent API.
4. Browser microphone audio is captured with an `AudioWorklet`, converted to 24 kHz PCM16, and sent to the agent.
5. The app enforces a 30-second pitch timer in the frontend.
6. The selected judges ask up to four questions.
7. The agent calls `generate_verdict_card`.
8. The frontend renders the final scorecard.

## Project Structure

```text
.
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── server.mjs
├── site
│   ├── app.js
│   ├── audio-worklet.js
│   ├── index.html
│   └── styles.css
├── .env
└── .gitignore
```

## Key Files

`server.mjs`

Runs the local Node server, serves the static website, and exposes `/api/voice-token`. This route calls AssemblyAI's token endpoint with the server-side API key and returns a browser-safe temporary token.

`site/index.html`

Defines the page structure: hero section, session status strip, judge selection cards, controls, live transcript panel, timer, and verdict card container.

`site/app.js`

Contains the main application logic:

- Judge selection and exactly-three enforcement
- Voice Agent WebSocket setup
- Session prompt and tool schema
- Browser microphone capture
- Live transcript handling
- 30-second pitch timer
- Pitch interruption
- Verdict card rendering

`site/audio-worklet.js`

Captures microphone audio in the browser audio thread, resamples it to 24 kHz, converts Float32 audio to PCM16, and sends 50 ms audio chunks back to the main app script.

`site/styles.css`

Controls the full visual experience: dramatic pitch-stage layout, judge cards, timer ring, live transcript panel, responsive behavior, and final scorecard styling.

`AGENTS.md`

Stores the AssemblyAI coding-agent instruction reminder to fetch current AssemblyAI docs before writing API code.

`.env.example`

Documents the required environment variables. Copy this to `.env` locally and add your AssemblyAI API key.

## Setup

Create a local `.env` file:

```bash
cp .env.example .env
```

Then add your AssemblyAI API key:

```text
ASSEMBLYAI_API_KEY=your-api-key-here
PORT=8787
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:8787
```

## Deploy publicly

PitchPanel AI is a single Node server that serves the static site and mints short-lived AssemblyAI tokens. Any platform that runs Node and exposes HTTPS works (Render, Railway, Fly.io, etc.).

### Option A: Render (recommended)

1. Push this repo to GitHub.
2. Create a [Render](https://render.com) account and click **New → Blueprint**.
3. Connect the GitHub repo. Render reads `render.yaml` and creates the web service.
4. When prompted, set `ASSEMBLYAI_API_KEY` to your AssemblyAI API key.
5. Deploy. Render assigns a public URL like `https://pitchpanel-ai.onrender.com`.
6. Open the URL in a browser and start a pitch session. Microphone access requires HTTPS, which Render provides automatically.

### Option B: Railway

1. Push the repo to GitHub.
2. Create a [Railway](https://railway.app) project from the repo.
3. Add an environment variable: `ASSEMBLYAI_API_KEY=your-key`.
4. Set the start command to `npm start` if Railway does not detect it automatically.
5. Generate a public domain under **Settings → Networking**.
6. Visit the generated URL.

### Option C: Any VPS or container host

1. Install Node.js 18+ on the server.
2. Clone the repo and run:

```bash
npm install
export ASSEMBLYAI_API_KEY=your-key
export NODE_ENV=production
export PORT=8787
npm start
```

3. Put nginx or Caddy in front for HTTPS and proxy to `localhost:8787`.
4. Open your domain in a browser.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | Yes | Server-side AssemblyAI key used to mint temporary voice tokens |
| `PORT` | No | HTTP port (platforms like Render set this automatically) |
| `HOST` | No | Bind address (default `0.0.0.0` for public deployment) |
| `NODE_ENV` | No | Set to `production` in deployed environments |

The `/api/voice-token` route is rate-limited to 10 requests per IP per minute to reduce API key abuse.

## Security Notes

- Do not commit `.env`.
- Do not put the AssemblyAI API key in browser code.
- The frontend only receives temporary Voice Agent tokens.
- If an API key is ever pasted into chat, logs, or committed by accident, rotate it in the AssemblyAI dashboard.

## Current Judges

- Vivian Cross: VC Shark focused on growth, monetization, fundraising, and scale.
- Theo Park: Technical Founder focused on engineering, product, AI, data, and moat.
- Maya Chen: Kind Operator focused on users, workflow, customer pain, and execution.
- Dante Reed: Blunt Shark focused on risk, competition, weak assumptions, and failure modes.
- Priya Shah: Impact Strategist focused on trust, ethics, accessibility, and sustainability.

## Verdict Card

The final card includes:

- Startup name and summary
- Selected judges
- Ten rubric scores
- Biggest strength
- Biggest risk
- Most likely failure mode
- Recommended next step
- Presentation, pause, and pace feedback
- Final investment verdict
