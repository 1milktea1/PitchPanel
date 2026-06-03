const pitchSeconds = 30;

const judges = [
  {
    id: "vivian",
    name: "Vivian Cross",
    title: "VC Shark",
    voice: "ivy",
    specialty: "Venture capital, growth, monetization, fundraising",
    personality: "Sharp, skeptical, strategic",
    style: "I need numbers, not vibes.",
    focuses: ["TAM", "Revenue", "Customer acquisition", "Retention", "Scale"],
    accent: "Cold read on the money story"
  },
  {
    id: "theo",
    name: "Theo Park",
    title: "Technical Founder",
    voice: "jack",
    specialty: "Engineering, product, AI, data",
    personality: "Analytical, direct, rational",
    style: "What is actually difficult to build here?",
    focuses: ["Technical moat", "Data moat", "Architecture", "Competitive advantage"],
    accent: "Cuts through product fog"
  },
  {
    id: "maya",
    name: "Maya Chen",
    title: "Kind Operator",
    voice: "winter",
    specialty: "Operations, users, customer experience",
    personality: "Warm, encouraging, practical",
    style: "Walk me through the customer.",
    focuses: ["User pain", "Workflow", "Customer interviews", "Execution"],
    accent: "Warm pressure, practical lens"
  },
  {
    id: "dante",
    name: "Dante Reed",
    title: "Blunt Shark",
    voice: "tyler",
    specialty: "Startup failure, competition, risk",
    personality: "Funny, brutally honest, dramatic",
    style: "That sounds like a feature, not a company.",
    focuses: ["Weak assumptions", "Competition", "Fatal flaws", "Failure modes"],
    accent: "Most likely to interrupt"
  },
  {
    id: "priya",
    name: "Priya Shah",
    title: "Impact Strategist",
    voice: "sophie",
    specialty: "Ethics, brand trust, social impact",
    personality: "Thoughtful, mission-driven, strategic",
    style: "Good intentions are not a business model.",
    focuses: ["Trust", "Accessibility", "Impact", "Sustainability"],
    accent: "Mission with commercial discipline"
  }
];

const state = {
  selectedIds: [],
  ws: null,
  micStream: null,
  inputContext: null,
  playbackContext: null,
  inputNodes: [],
  source: null,
  playbackTime: 0,
  timer: null,
  sentTimeUp: false,
  pendingToolResult: null,
  status: "idle",
  partialUserLine: null
};

const el = {
  judgeGrid: document.querySelector("#judgeGrid"),
  selectedCount: document.querySelector("#selectedCount"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  notice: document.querySelector("#notice"),
  statusText: document.querySelector("#statusText"),
  activeJudge: document.querySelector("#activeJudge"),
  secondsLeft: document.querySelector("#secondsLeft"),
  timerNumber: document.querySelector("#timerNumber"),
  timerRing: document.querySelector("#timerRing"),
  transcriptLog: document.querySelector("#transcriptLog"),
  verdictCard: document.querySelector("#verdictCard")
};

const voiceByFirstName = new Map(judges.map((judge) => [judge.name.split(" ")[0], judge.voice]));

renderJudges();
updateControls();

el.startButton.addEventListener("click", startSession);
el.stopButton.addEventListener("click", endSession);

function renderJudges() {
  el.judgeGrid.innerHTML = judges
    .map(
      (judge) => `
      <button type="button" class="judge-card" data-id="${judge.id}">
        <span class="judge-topline">
          <strong>${judge.name}</strong>
          <span class="checkmark" aria-hidden="true">✓</span>
        </span>
        <span class="judge-title">${judge.title}</span>
        <span class="judge-quote">"${judge.style}"</span>
        <span class="judge-meta">${judge.accent}</span>
      </button>
    `
    )
    .join("");

  el.judgeGrid.querySelectorAll(".judge-card").forEach((button) => {
    button.addEventListener("click", () => toggleJudge(button.dataset.id));
  });
}

function toggleJudge(id) {
  if (state.selectedIds.includes(id)) {
    state.selectedIds = state.selectedIds.filter((judgeId) => judgeId !== id);
  } else if (state.selectedIds.length < 3) {
    state.selectedIds.push(id);
  }
  updateControls();
}

function selectedJudges() {
  return judges.filter((judge) => state.selectedIds.includes(judge.id));
}

function updateControls() {
  const selected = selectedJudges();
  el.selectedCount.textContent = `${selected.length}/3`;
  el.startButton.disabled = selected.length !== 3 || state.status === "live" || state.status === "connecting";
  el.stopButton.disabled = state.status !== "live" && state.status !== "connecting";

  el.judgeGrid.querySelectorAll(".judge-card").forEach((button) => {
    const selectedCard = state.selectedIds.includes(button.dataset.id);
    button.classList.toggle("selected", selectedCard);
    button.disabled = !selectedCard && state.selectedIds.length === 3;
  });
}

async function startSession() {
  const selected = selectedJudges();
  if (selected.length !== 3) return;

  state.status = "connecting";
  updateControls();
  setStatus("Minting a temporary Voice Agent token...");
  setActiveJudge("Panel");
  clearTranscript();
  hideVerdict();

  try {
    showNotice("", "info");
    const tokenRes = await fetch("/api/voice-token");
    const tokenPayload = await tokenRes.json();
    if (!tokenRes.ok || !tokenPayload.token) {
      const details = tokenPayload.details?.error || tokenPayload.details?.message || "";
      throw new Error(
        [tokenPayload.error || "Could not mint Voice Agent token.", details].filter(Boolean).join(" ")
      );
    }

    const ws = new WebSocket(
      `wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(tokenPayload.token)}`
    );
    state.ws = ws;

    ws.addEventListener("open", () => {
      setStatus("Configuring the investor panel...");
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            system_prompt: buildSystemPrompt(selected),
            greeting: buildGreeting(selected),
            input: {
              format: { encoding: "audio/pcm" },
              keyterms: buildKeyterms(selected),
              turn_detection: {
                vad_threshold: 0.5,
                min_silence: 200,
                max_silence: 1000,
                interrupt_response: true
              }
            },
            output: {
              voice: selected[0].voice,
              format: { encoding: "audio/pcm" },
              volume: 88
            },
            tools: [verdictTool()]
          }
        })
      );
    });

    ws.addEventListener("message", async (message) => {
      await handleAgentEvent(JSON.parse(message.data));
    });

    ws.addEventListener("error", () => {
      state.status = "error";
      setStatus("The Voice Agent connection hit an error.");
      updateControls();
    });

    ws.addEventListener("close", () => {
      if (state.status !== "finished") setStatus("Voice Agent session closed.");
      stopAudio();
      state.status = state.status === "finished" ? "finished" : "idle";
      updateControls();
    });
  } catch (error) {
    state.status = "error";
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message);
    showNotice(message, "error");
    updateControls();
  }
}

async function handleAgentEvent(event) {
  if (event.type === "session.ready") {
    state.status = "live";
    updateControls();
    setStatus("Mic is opening...");
    await startAudio();
    return;
  }

  if (event.type === "reply.audio" && typeof event.data === "string") {
    playPcmAudio(event.data);
    return;
  }

  if (event.type === "reply.done") {
    if (event.status === "interrupted") {
      state.pendingToolResult = null;
      flushPlayback();
      return;
    }

    if (state.pendingToolResult && state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: "tool.result",
          call_id: state.pendingToolResult.callId,
          result: state.pendingToolResult.result
        })
      );
      state.pendingToolResult = null;
    }
    return;
  }

  if (event.type === "transcript.user.delta" && typeof event.text === "string") {
    showPartialUserTranscript(event.text);
    return;
  }

  if (event.type === "transcript.user" && typeof event.text === "string") {
    commitUserTranscript(event.text);
    return;
  }

  if (event.type === "transcript.agent" && typeof event.text === "string") {
    addTranscript(event.text);
    const firstName = event.text.split(":")[0];
    if (firstName) {
      setActiveJudge(firstName);
    }
    if (event.text.includes("Start when ready")) {
      startPitchTimer();
    }
    return;
  }

  if (event.type === "tool.call" && event.name === "generate_verdict_card") {
    const card = safeVerdict(event.arguments, selectedJudges());
    renderVerdict(card);
    state.status = "finished";
    setStatus("Verdict card generated.");
    updateControls();

    if (typeof event.call_id === "string") {
      state.pendingToolResult = {
        callId: event.call_id,
        result: JSON.stringify({ displayed: true })
      };
    }
    return;
  }

  if (event.type === "session.error") {
    state.status = "error";
    const message = event.message || "Voice Agent session error.";
    setStatus(message);
    showNotice(message, "error");
    updateControls();
  }
}

async function startAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  state.micStream = stream;

  const inputContext = new AudioContext();
  state.inputContext = inputContext;
  await inputContext.audioWorklet.addModule("/audio-worklet.js");

  const source = inputContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(inputContext, "pitchpanel-processor");
  const mutedOutput = inputContext.createGain();
  mutedOutput.gain.value = 0;

  worklet.port.onmessage = (message) => {
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: "input.audio",
          audio: arrayBufferToBase64(message.data)
        })
      );
    }
  };

  source.connect(worklet);
  worklet.connect(mutedOutput);
  mutedOutput.connect(inputContext.destination);
  state.inputNodes = [source, worklet, mutedOutput];
  setStatus("Mic is open. Waiting for the panel intro.");
}

function startPitchTimer() {
  clearInterval(state.timer);
  state.sentTimeUp = false;
  setClock(pitchSeconds);
  el.timerRing.classList.add("running");
  setStatus("Panel is listening. Your 30 seconds are running.");

  const started = Date.now();
  state.timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const next = Math.max(0, pitchSeconds - elapsed);
    setClock(next);

    if (next === 0 && !state.sentTimeUp) {
      state.sentTimeUp = true;
      clearInterval(state.timer);
      el.timerRing.classList.remove("running");
      interruptPitch();
    }
  }, 250);
}

function interruptPitch() {
  if (state.ws?.readyState !== WebSocket.OPEN) return;
  const selected = selectedJudges();
  const interrupter = selected.find((judge) => judge.id === "dante") || selected[0];
  setActiveJudge(interrupter.name.split(" ")[0]);
  state.ws.send(
    JSON.stringify({
      type: "reply.create",
      instructions:
        `${interrupter.name} interrupts immediately. Say: "Time. I'm going to stop you there." ` +
        "Then move into Round 1 and ask the first selected judge's first specific question about the startup pitch. Ask only one question."
    })
  );
  setStatus("Time. The panel is moving into questions.");
}

function playPcmAudio(base64) {
  const context = state.playbackContext || new AudioContext({ sampleRate: 24000 });
  state.playbackContext = context;

  const samples = int16ToFloat32(base64ToInt16(base64));
  const buffer = context.createBuffer(1, samples.length, 24000);
  buffer.copyToChannel(samples, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  state.source = source;

  const startAt = Math.max(context.currentTime, state.playbackTime);
  source.start(startAt);
  state.playbackTime = startAt + buffer.duration;
}

function flushPlayback() {
  try {
    state.source?.stop();
  } catch {
    // Source may have already finished.
  }
  state.source = null;
  state.playbackTime = state.playbackContext?.currentTime || 0;
}

function stopAudio() {
  state.micStream?.getTracks().forEach((track) => track.stop());
  state.inputNodes.forEach((node) => node.disconnect());
  state.inputContext?.close();
  state.playbackContext?.close();
  state.micStream = null;
  state.inputContext = null;
  state.playbackContext = null;
  state.inputNodes = [];
}

function endSession() {
  clearInterval(state.timer);
  el.timerRing.classList.remove("running");
  stopAudio();
  state.ws?.close();
  state.ws = null;
  state.status = "finished";
  setStatus("Session stopped.");
  updateControls();
}

function buildSystemPrompt(selected) {
  const panel = selected
    .map(
      (judge) => `
${judge.name} - ${judge.title}
Specialty: ${judge.specialty}
Personality: ${judge.personality}
Style line: "${judge.style}"
Focuses on: ${judge.focuses.join(", ")}
Voice used by the frontend: ${judge.voice}`
    )
    .join("\n");

  return `
You are PitchPanel AI, a compressed Shark Tank-style startup pitch meeting.
You are not a generic assistant. Always speak as exactly one selected judge and prefix every spoken response with the judge name, for example "Vivian: Walk me through your revenue model."

Selected panel:
${panel}

Session flow:
1. Introduce the selected judges briefly.
2. Say exactly: "You have 30 seconds. Start when ready."
3. Let the founder pitch.
4. When the app says time is up, stop the pitch and begin questioning.
5. Round 1: each selected judge asks exactly one specific question based on the pitch.
6. Round 2: identify the weakest area and have the most relevant judge ask one follow-up question.
7. Ask no more than 4 total questions.
8. After the final user answer, call generate_verdict_card.

Question rules:
- Ask only one question at a time.
- Wait for the founder's response.
- Do not reveal scores until the verdict card.
- Do not invent metrics.
- If the founder does not know an answer, identify the gap and why it matters in one sentence, then continue.
- Keep replies short, energetic, realistic, and useful.
- Dante may interrupt rambling answers, but keep interruptions brief.

Presentation analysis:
Evaluate startup quality and founder delivery. Track speaking pace, confidence, long pauses, hesitation, rambling, filler words, clarity, and structure.
Use pause feedback exactly in spirit:
- Frequent long pauses: "The pitch lost momentum due to long pauses."
- Barely pauses: "The pitch felt rushed and difficult to follow."
- Pauses between many individual words: "The delivery sounded hesitant."
- Strong pacing: "The pacing felt confident and natural."

Startup rubric scores must be integers from 1 to 10:
problem_clarity, customer_clarity, market_potential, business_model, product_feasibility, defensibility, founder_communication, pitch_pacing, confidence, overall_investment_potential.

Failure modes to choose from:
No market need, Weak differentiation, Poor distribution, Unclear monetization, Difficult operations, Regulatory risk, Trust and safety concerns, Weak retention.

Allowed final verdict strings:
- I'm in.
- I'm interested, but not yet convinced.
- Come back when you have users.
- This is weird enough that I want to hear more.
- For those reasons, I'm out.

Call generate_verdict_card once, after the final question has been answered. Fill every field. The tool result powers the visual scorecard.
`.trim();
}

function buildGreeting(selected) {
  return `${selected.map((judge) => `${judge.name}, ${judge.title}`).join("; ")}. You have 30 seconds. Start when ready.`;
}

function buildKeyterms(selected) {
  return [
    "PitchPanel AI",
    "TAM",
    "MVP",
    "CAC",
    "retention",
    "moat",
    "monetization",
    "venture-scale",
    "defensibility",
    ...selected.flatMap((judge) => judge.name.split(" "))
  ];
}

function verdictTool() {
  return {
    type: "function",
    name: "generate_verdict_card",
    description:
      "Generate the final PitchPanel AI scorecard after the founder has answered all panel questions.",
    execution_mode: "interactive",
    parameters: {
      type: "object",
      properties: {
        startup_name: { type: "string" },
        one_sentence_summary: { type: "string" },
        selected_judges: { type: "array", items: { type: "string" } },
        scores: {
          type: "object",
          properties: Object.fromEntries(
            [
              "problem_clarity",
              "customer_clarity",
              "market_potential",
              "business_model",
              "product_feasibility",
              "defensibility",
              "founder_communication",
              "pitch_pacing",
              "confidence",
              "overall_investment_potential"
            ].map((key) => [key, { type: "number" }])
          )
        },
        biggest_strength: { type: "string" },
        biggest_risk: { type: "string" },
        failure_mode: { type: "string" },
        recommended_next_step: { type: "string" },
        presentation_feedback: { type: "string" },
        pause_feedback: { type: "string" },
        pace_feedback: { type: "string" },
        verdict: { type: "string" }
      },
      required: [
        "startup_name",
        "one_sentence_summary",
        "selected_judges",
        "scores",
        "biggest_strength",
        "biggest_risk",
        "failure_mode",
        "recommended_next_step",
        "presentation_feedback",
        "pause_feedback",
        "pace_feedback",
        "verdict"
      ]
    }
  };
}

function safeVerdict(args, selected) {
  const fallback = {
    startup_name: "Untitled startup",
    one_sentence_summary: "The panel did not receive enough detail to summarize the startup.",
    selected_judges: selected.map((judge) => judge.name),
    scores: {
      problem_clarity: 5,
      customer_clarity: 5,
      market_potential: 5,
      business_model: 5,
      product_feasibility: 5,
      defensibility: 5,
      founder_communication: 5,
      pitch_pacing: 5,
      confidence: 5,
      overall_investment_potential: 5
    },
    biggest_strength: "The founder completed the pitch.",
    biggest_risk: "The panel needs more evidence.",
    failure_mode: "Unclear monetization",
    recommended_next_step: "Interview customers and return with evidence.",
    presentation_feedback: "The pitch needs sharper structure.",
    pause_feedback: "The pacing needs more polish.",
    pace_feedback: "Aim for concise, deliberate answers.",
    verdict: "I'm interested, but not yet convinced."
  };

  if (!args || typeof args !== "object") return fallback;
  const card = { ...fallback, ...args };
  card.selected_judges = Array.isArray(card.selected_judges)
    ? card.selected_judges
    : fallback.selected_judges;
  card.scores = { ...fallback.scores, ...(args.scores || {}) };
  Object.keys(card.scores).forEach((key) => {
    const score = Number(card.scores[key]);
    card.scores[key] = Number.isFinite(score) ? Math.max(1, Math.min(10, Math.round(score))) : 5;
  });
  return card;
}

function renderVerdict(card) {
  const scores = Object.entries(card.scores)
    .map(
      ([key, value]) => `
      <div class="score-row">
        <span>${labelize(key)}</span>
        <strong>${value}/10</strong>
        <meter min="1" max="10" value="${value}"></meter>
      </div>`
    )
    .join("");

  el.verdictCard.innerHTML = `
    <div class="verdict-head">
      <div>
        <div class="eyebrow">Final scorecard</div>
        <h2>${escapeHtml(card.startup_name)}</h2>
        <p>${escapeHtml(card.one_sentence_summary)}</p>
      </div>
      <div class="verdict-badge">${escapeHtml(card.verdict)}</div>
    </div>
    <div class="score-grid">${scores}</div>
    <div class="verdict-details">
      ${detail("Strength", card.biggest_strength)}
      ${detail("Risk", card.biggest_risk)}
      ${detail("Failure mode", card.failure_mode)}
      ${detail("Next step", card.recommended_next_step)}
      ${detail("Presentation", card.presentation_feedback)}
      ${detail("Pauses", card.pause_feedback)}
      ${detail("Pace", card.pace_feedback)}
    </div>
  `;
  el.verdictCard.classList.remove("hidden");
  el.verdictCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function detail(label, value) {
  return `
    <div class="detail">
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(value)}</p>
    </div>`;
}

function hideVerdict() {
  el.verdictCard.classList.add("hidden");
  el.verdictCard.innerHTML = "";
}

function setStatus(text) {
  el.statusText.textContent = text;
}

function showNotice(text, tone = "info") {
  el.notice.textContent = text;
  el.notice.className = text ? `notice ${tone}` : "notice hidden";
}

function setActiveJudge(name) {
  el.activeJudge.textContent = name;
}

function setClock(seconds) {
  el.secondsLeft.textContent = seconds;
  el.timerNumber.textContent = seconds;
  el.timerRing.style.setProperty("--progress", String(seconds / pitchSeconds));
}

function clearTranscript() {
  el.transcriptLog.innerHTML =
    '<p class="empty-state">The panel transcript will appear here once the session starts.</p>';
  state.partialUserLine = null;
}

function addTranscript(line) {
  if (el.transcriptLog.querySelector(".empty-state")) el.transcriptLog.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = line;
  el.transcriptLog.appendChild(p);
  el.transcriptLog.scrollTop = el.transcriptLog.scrollHeight;
}

function showPartialUserTranscript(text) {
  if (el.transcriptLog.querySelector(".empty-state")) el.transcriptLog.innerHTML = "";
  if (!state.partialUserLine) {
    state.partialUserLine = document.createElement("p");
    state.partialUserLine.className = "partial";
    el.transcriptLog.appendChild(state.partialUserLine);
  }
  state.partialUserLine.textContent = `Founder: ${text}`;
  el.transcriptLog.scrollTop = el.transcriptLog.scrollHeight;
}

function commitUserTranscript(text) {
  if (state.partialUserLine) {
    state.partialUserLine.remove();
    state.partialUserLine = null;
  }
  addTranscript(`Founder: ${text}`);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToInt16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function int16ToFloat32(input) {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i] / (input[i] < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}

function labelize(key) {
  return key
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
