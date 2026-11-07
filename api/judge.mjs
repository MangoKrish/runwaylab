// The Gemini judge. This one file runs on Vercel in production and under `npm run dev` locally.
// The key lives only here on the server. Secrets: GEMINI_API_KEY. Optional: GEMINI_MODEL, GEMINI_PAID_TIER=1.
import { PROFILES } from './_profiles.mjs';
import { json, refuse, sameSite, signJudge } from './_common.mjs';

const API_BASE = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash'; // Badged Stable when checked, 7 November 2026.
const MAX_STILLS = 16;
const MAX_STILL_BASE64 = 700_000;
const MAX_NOTE_CHARS = 400;

const PROMPT = (measurements, count) => `You are a strict, fair judge in RunwayLab, a runway game at a student hackathon.

You are looking at ${count} stills, in time order, from one person's walk toward a camera, a turn, and the walk back. Each still is cropped to the walker and the face has been deliberately pixelated.

Score two things from 0 to 15, using this scale exactly:
- 0 to 3: ordinary, like walking to class. Nothing about it says runway.
- 4 to 7: a normal person trying a little. This is where most people belong.
- 8 to 10: clear intent and control. Better than most people who try this.
- 11 to 13: would hold attention in a student fashion show.
- 14 to 15: professional. Almost nobody here earns this, so be very sure.

Be honest. Being friendly is not a reason to score higher. An everyday outfit and an everyday walk belong at 3 to 7.

- presence: confidence, intent and how they carry themselves across the stills.
- style: how their outfit and attitude work together, and the personality they bring. Nice clothes alone earn little. A plain T-shirt worn with real conviction can beat an expensive outfit worn apologetically.

Then:
- match: choose the one walk below that is closest to how this person moves. Base it only on movement and attitude, never on looks.
- verdict: one witty, warm sentence, at most 25 words. Honest with some bite, never an insult.
- tip: the single most useful thing for them to try next, in one short sentence.
- moments: up to 3 notes on specific stills, using the still's position in the list, counting from 0. Each note gives one concrete observation.

Rules you must follow:
- Judge choices and movement only. Never mention, rate or infer body shape, size, weight, height, face, attractiveness, age, race, ethnicity, gender, religion, health or disability.
- If someone uses a mobility aid, judge their presence and style exactly as you would anyone's, and do not remark on it.
- Do not try to work out who the person is.
- Do not state numbers about their posture or an overall score. Code measured the following and handles all of that, and they are not part of your scores. They are for your context only: ${JSON.stringify(measurements)}.
- Code has already confirmed that this person walked up and back, so judge what you can see, even if a still catches them mid-turn or standing. Set judgeable to false only if no person is visible at all, and then still fill the other fields with zeros and short placeholders.

Walks to choose from:
${PROFILES.map((p) => `- ${p.id}: ${p.name}, "${p.tag}". ${p.walk}`).join('\n')}`;

const SCHEMA = {
  type: 'object',
  properties: {
    judgeable: { type: 'boolean' },
    presence: { type: 'integer', minimum: 0, maximum: 15 },
    presenceWhy: { type: 'string' },
    style: { type: 'integer', minimum: 0, maximum: 15 },
    styleWhy: { type: 'string' },
    match: { type: 'string', enum: PROFILES.map((p) => p.id) },
    matchWhy: { type: 'string' },
    verdict: { type: 'string' },
    tip: { type: 'string' },
    moments: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: { still: { type: 'integer' }, note: { type: 'string' } },
        required: ['still', 'note'],
      },
    },
  },
  required: ['judgeable', 'presence', 'presenceWhy', 'style', 'styleWhy', 'match', 'matchWhy', 'verdict', 'tip', 'moments'],
};

const trim = (text, max = MAX_NOTE_CHARS) => String(text ?? '').trim().slice(0, max);

/** Never trust the model's output: range-check it and rebuild it field by field. */
export function checkAnswer(answer, stillCount) {
  if (!answer || typeof answer !== 'object') return null;
  const inRange = (x) => Number.isInteger(x) && x >= 0 && x <= 15;
  if (typeof answer.judgeable !== 'boolean') return null;
  if (answer.judgeable === false) return { judgeable: false };
  if (!inRange(answer.presence) || !inRange(answer.style)) return null;
  const profile = PROFILES.find((p) => p.id === answer.match);
  if (!profile || !trim(answer.verdict)) return null;
  return {
    judgeable: true,
    presence: { score: answer.presence, why: trim(answer.presenceWhy) },
    style: { score: answer.style, why: trim(answer.styleWhy) },
    match: { id: profile.id, name: profile.name, tag: profile.tag, why: trim(answer.matchWhy) },
    verdict: trim(answer.verdict, 240),
    tip: trim(answer.tip, 240),
    moments: (Array.isArray(answer.moments) ? answer.moments : [])
      .filter((m) => Number.isInteger(m?.still) && m.still >= 0 && m.still < stillCount && trim(m.note))
      .slice(0, 3)
      .map((m) => ({ still: m.still, note: trim(m.note) })),
  };
}

function checkStills(stills) {
  if (!Array.isArray(stills) || stills.length === 0) return 'No stills were sent.';
  if (stills.length > MAX_STILLS) return `At most ${MAX_STILLS} stills are accepted.`;
  for (const s of stills) {
    if (typeof s?.jpeg !== 'string' || !s.jpeg || s.jpeg.length > MAX_STILL_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(s.jpeg)) return 'One of the stills is not a valid image.';
  }
  return null;
}

function cleanMeasurements(input) {
  const out = {};
  for (const key of ['footPlacementPercentOfHeight', 'shoulderRockDegrees', 'trunkSwayDegrees', 'straightLinePercentOfHeight', 'headMovementPercentOfHeight']) {
    if (Number.isFinite(input?.[key])) out[key] = input[key];
  }
  return out;
}

/**
 * A 503 means the model is busy, which Gemini's Flash models do during demand spikes. Wait and try again,
 * then try other models once each, so a busy minute does not cost a walker their judgment. A 429 means this model's
 * quota has run out. The free tier allows 20 requests per model per day, so waiting will not help, and the next
 * model has its own allowance.
 */
const FALLBACK_MODELS = 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash';
// A model can hang for minutes instead of answering. Good answers take 8 to 27 s, so give each model 40, and stop
// before the page gives up at 120.
const ATTEMPT_MS = () => Number(process.env.GEMINI_TIMEOUT_MS ?? 40000);
const TOTAL_MS = 100000;

async function askWithRetries(stills, measurements, key, ask) {
  const wait = Number(process.env.GEMINI_RETRY_MS ?? 1500);
  const others = (process.env.GEMINI_FALLBACK_MODEL ?? FALLBACK_MODELS).split(',').map((m) => m.trim()).filter((m) => m && m !== MODEL());
  const attempts = [MODEL(), MODEL(), ...others];
  const usedUp = new Set();
  let res = null;
  let busy = null;
  let model = MODEL();
  const started = Date.now();
  for (let i = 0; i < attempts.length; i++) {
    const left = TOTAL_MS - (Date.now() - started);
    if (left <= 0) break;
    if (usedUp.has(attempts[i])) continue;
    if (res?.status === 503) await new Promise((r) => setTimeout(r, wait));
    model = attempts[i];
    try {
      res = await ask(stills, measurements, key, model, AbortSignal.timeout(Math.min(ATTEMPT_MS(), left)));
    } catch (err) {
      if (err?.name !== 'TimeoutError') throw err;
      // Hanging once means asking the same model again would likely waste the wait, so move on.
      usedUp.add(model);
      res = new Response(null, { status: 503 });
      busy = res;
      continue;
    }
    // Quota is counted per model, so one that has run out says nothing about the next.
    if (res.status === 429) usedUp.add(model);
    else if (res.status === 503) busy = res;
    else break;
  }
  // If any model was only busy, trying again later can still work, so that is the honest thing to report.
  if (res.status === 429 && busy) res = busy;
  return { res, model };
}

/** Whether Gemini says this limit lasts all day, which is different advice from a limit that clears in a minute. */
async function isDailyLimit(res) {
  const body = await res.clone().json().catch(() => null);
  const failure = body?.error?.details?.find((d) => d['@type']?.includes('QuotaFailure'));
  return !!failure?.violations?.some((v) => /PerDay/i.test(v.quotaId ?? ''));
}

async function askInEitherFormat(stills, measurements, key, model, signal) {
  // The documented REST form uses responseFormat. Its SDK examples use the other two field names, and
  // the docs do not explain the difference, so fall back once if the API rejects the first form.
  const res = await callGemini(stills, measurements, key, model, { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: SCHEMA } } }, signal);
  if (res.status !== 400) return res;
  return callGemini(stills, measurements, key, model, { responseMimeType: 'application/json', responseJsonSchema: SCHEMA }, signal);
}

async function callGemini(stills, measurements, key, model, formatConfig, signal) {
  return fetch(`${API_BASE()}/models/${model}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{
        parts: [
          ...stills.map((s) => ({ inline_data: { mime_type: 'image/jpeg', data: s.jpeg } })),
          { text: PROMPT(measurements, stills.length) },
        ],
      }],
      generationConfig: { temperature: 0.4, ...formatConfig },
    }),
  });
}

/** Tells the page whether a judge is connected, and which data terms apply. Does not reveal the key. */
export async function GET() {
  return json(200, { ready: !!process.env.GEMINI_API_KEY, model: MODEL(), paidTier: process.env.GEMINI_PAID_TIER === '1' });
}

export async function POST(request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return refuse(503, 'no_key', 'The judge is not connected yet: this server has no Gemini API key.');
  if (!sameSite(request)) return refuse(403, 'forbidden', 'This judge only answers its own site.');

  let body;
  try {
    body = await request.json();
  } catch {
    return refuse(400, 'bad_request', 'That request could not be read.');
  }
  const problem = checkStills(body?.stills);
  if (problem) return refuse(400, 'bad_request', problem);
  const measurements = cleanMeasurements(body.measurements);

  let res;
  let usedModel;
  try {
    ({ res, model: usedModel } = await askWithRetries(body.stills, measurements, key, askInEitherFormat));
  } catch {
    return refuse(502, 'unreachable', 'The server could not reach Gemini. Try again.');
  }

  if (res.status === 503) return refuse(503, 'busy', 'Gemini is very busy right now. Wait a moment and try again.');
  if (res.status === 429) {
    if (await isDailyLimit(res)) return refuse(429, 'out_of_quota', 'The judge has used all of today\'s requests, so this walk keeps its measured score. More become available at midnight Pacific time.');
    return refuse(429, 'rate_limited', 'The judge is at its request limit. Wait a minute and try again.');
  }
  if (res.status === 401 || res.status === 403) return refuse(502, 'bad_key', 'Gemini rejected this server\'s API key.');
  if (res.status === 404) return refuse(502, 'bad_model', `Gemini does not recognise the model "${MODEL()}".`);
  if (!res.ok) return refuse(502, 'upstream', `Gemini returned an error (${res.status}). Try again.`);

  const reply = await res.json().catch(() => null);
  if (reply?.promptFeedback?.blockReason) return refuse(422, 'blocked', 'Gemini declined to judge these stills.');
  const candidate = reply?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    return candidate?.finishReason && candidate.finishReason !== 'STOP'
      ? refuse(422, 'blocked', 'Gemini declined to judge these stills.')
      : refuse(502, 'bad_answer', 'Gemini gave an empty answer. Try again.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse(502, 'bad_answer', 'Gemini gave an answer that could not be read. Try again.');
  }
  const answer = checkAnswer(parsed, body.stills.length);
  if (!answer) return refuse(502, 'bad_answer', 'Gemini gave an answer that did not fit. Try again.');
  if (!answer.judgeable) return refuse(422, 'not_judgeable', 'Gemini could not see a person in these stills.');

  const { judgeable, ...result } = answer;
  // The signature is what lets the wall trust this result later without asking Gemini again.
  return json(200, { ok: true, model: usedModel, ...result, sig: signJudge(result) });
}
