// Claude integration for the WFUMC Social Media app.
//
// Routes through the same `claude-proxy` Edge Function the bulletin
// and sermons apps use. The proxy is auth-gated (any authenticated
// user) — it pulls the Anthropic key from public.church_settings
// server-side so the key never leaves the server.

import { supabase, withTimeout } from './supabase';
import { prepareImageForUpload, blobToBase64 } from './imageHelpers';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

/**
 * Low-level proxy call. Mirrors the other apps' callClaude.
 * @param {Object} body { messages, system?, max_tokens?, model? }
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=60000] Inference can be slow; default
 *   60s. Vision calls can be longer, so callers can override.
 */
export async function callClaude(body, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not signed in');
  }
  let res;
  try {
    res = await withTimeout(
      fetch(`${supabaseUrl}/functions/v1/claude-proxy`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }),
      timeoutMs
    );
  } catch (e) {
    if (String(e?.message || '').includes('Request timed out')) {
      throw new Error(
        `Claude took longer than ${Math.round(timeoutMs / 1000)}s to respond. Try again.`
      );
    }
    throw e;
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude proxy error ${res.status}: ${errBody}`);
  }
  return res.json();
}

function extractText(response) {
  const block = response?.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

function parseJsonLoose(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Shared system prompt skeleton — same voice/audience guidance across
// every draft variant.
const VOICE_GUIDANCE = [
  "You write social media posts for Wedowee First United Methodist Church.",
  "Voice: warm, neighborly, conversational. Welcoming, not preachy. Trust",
  "the reader to bring their own conclusions. Specific over abstract.",
  "Plain language — avoid churchy jargon. One clear idea per post.",
  '',
  'Length guidance: Facebook/Instagram captions land best at 2-4 short',
  'paragraphs. X/Twitter at ~250 chars. When unsure, lean shorter.',
  '',
  "Don't use hashtags unless the user asks. Don't use emojis unless they",
  'genuinely add warmth (occasional ✨ ❤️ 🙏 are fine; avoid spammy walls).',
  "Don't fake-quote anyone. Don't promise things the church hasn't said.",
].join('\n');

// Helper to call Claude with a JSON-only system prompt and parse the
// result into { title?: string, body: string }.
async function generateDraft({ system, userMessage, contentBlocks, timeoutMs = 90000 }) {
  const response = await callClaude(
    {
      system,
      messages: [
        {
          role: 'user',
          content: contentBlocks ?? userMessage,
        },
      ],
      max_tokens: 1500,
    },
    { timeoutMs }
  );
  const text = extractText(response);
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error("Couldn't parse Claude's response as JSON.");
  }
  return {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
    body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
  };
}

// Build the JSON-output block of the system prompt — every draft
// helper returns the same shape.
const JSON_OUTPUT_INSTRUCTIONS = [
  'Return ONLY a JSON object with two keys:',
  '  title: a short internal label (5-8 words) for the team to recognize the post',
  '  body:  the actual social media post text, ready to copy/paste',
  'No prose, no explanation, no markdown — just the JSON object.',
].join('\n');

/**
 * Draft a post from a bulletin's response prompt. The response prompt
 * is already designed for the social media team; this helper just
 * polishes it into a posting-ready draft.
 *
 * @param {Object} input
 * @param {string} input.responsePrompt        - The bulletin's response prompt text
 * @param {string} [input.bulletinDesignation] - e.g., "Fifth Sunday of Easter"
 * @param {string} [input.serviceDate]         - YYYY-MM-DD
 * @param {string} [input.sermonTitle]
 * @param {string} [input.scriptureRef]
 */
export async function draftFromResponsePrompt({
  responsePrompt,
  bulletinDesignation,
  serviceDate,
  sermonTitle,
  scriptureRef,
}) {
  if (!responsePrompt?.trim()) {
    throw new Error('No response prompt text to draft from.');
  }
  const system = [
    VOICE_GUIDANCE,
    '',
    'Below is a "response prompt" the pastor wrote for the social media team',
    "after Sunday's service. Turn it into a single posting-ready draft. Stay",
    'true to the prompt — your job is to put it in posting voice, not to',
    'add new content.',
    '',
    JSON_OUTPUT_INSTRUCTIONS,
  ].join('\n');
  const ctx = [];
  if (bulletinDesignation) ctx.push(`Sunday: ${bulletinDesignation}`);
  if (serviceDate) ctx.push(`Date: ${serviceDate}`);
  if (sermonTitle) ctx.push(`Sermon: ${sermonTitle}`);
  if (scriptureRef) ctx.push(`Scripture: ${scriptureRef}`);
  const ctxBlock = ctx.length ? ctx.join('\n') + '\n\n' : '';
  return generateDraft({
    system,
    userMessage: `${ctxBlock}Response prompt:\n\n${responsePrompt.trim()}`,
  });
}

/**
 * Draft a post inviting people to a sermon (or sharing an excerpt from
 * one). Uses scripture + theme to ground the draft.
 */
export async function draftFromSermon({
  sermonTitle,
  scriptureRef,
  theme,
  manuscriptText,
  variant = 'invitation',
}) {
  const system = [
    VOICE_GUIDANCE,
    '',
    `Variant: ${variant}.`,
    '  - "invitation"   — invite people to come hear / listen to this sermon',
    '  - "excerpt"      — pull out a sharable line or two from the manuscript,',
    '                     plus a short setup',
    '  - "reflection"   — a brief reflection inspired by the sermon\'s theme',
    '',
    JSON_OUTPUT_INSTRUCTIONS,
  ].join('\n');
  const parts = [];
  if (sermonTitle) parts.push(`Sermon title: ${sermonTitle}`);
  if (scriptureRef) parts.push(`Scripture: ${scriptureRef}`);
  if (theme) parts.push(`Theme: ${theme}`);
  if (manuscriptText) {
    // Cap manuscript context to keep the prompt manageable.
    const trimmed = manuscriptText.trim();
    const max = 4000;
    parts.push(
      `Manuscript${trimmed.length > max ? ' (truncated)' : ''}:\n` +
        trimmed.slice(0, max)
    );
  }
  const userMessage = parts.join('\n\n');
  return generateDraft({ system, userMessage });
}

/**
 * Draft a post from free-form text (typed prompt — describe the event /
 * announcement / idea, get a polished post back).
 */
export async function draftFreeForm({ prompt }) {
  if (!prompt?.trim()) {
    throw new Error('Type something for Claude to work from.');
  }
  const system = [
    VOICE_GUIDANCE,
    '',
    'The user has typed a brief description of what they want to post about.',
    'Turn it into a posting-ready draft. If details are missing, write what',
    "you can without inventing facts (e.g., don't make up dates or names).",
    '',
    JSON_OUTPUT_INSTRUCTIONS,
  ].join('\n');
  return generateDraft({
    system,
    userMessage: `Topic / notes:\n\n${prompt.trim()}`,
  });
}

/**
 * Draft a post from one or more uploaded images using Claude vision.
 * Useful for event photos, group shots, behind-the-scenes images, etc.
 *
 * @param {Object} input
 * @param {Array<File|Blob>} input.images - up to 4
 * @param {string} [input.context]        - optional human-typed context
 *                                          (event name, who's pictured, etc.)
 */
export async function draftFromImage({ images, context }) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Add at least one image to draft from.');
  }
  const subset = images.slice(0, 4);
  const prepared = await Promise.all(
    subset.map(async (file) => {
      const { blob, mediaType } = await prepareImageForUpload(file, 1600, 0.85);
      const data = await blobToBase64(blob);
      return { mediaType, data };
    })
  );

  const system = [
    VOICE_GUIDANCE,
    '',
    'Look at the attached image(s) and draft a social media post about',
    "what's happening. Describe what you see in concrete, warm terms.",
    "If you can't tell exactly who or what something is, don't guess —",
    'speak about the scene at face value.',
    '',
    JSON_OUTPUT_INSTRUCTIONS,
  ].join('\n');

  const contentBlocks = [
    {
      type: 'text',
      text: context?.trim()
        ? `Context the user provided:\n${context.trim()}\n\nImage${
            subset.length === 1 ? '' : 's'
          } attached:`
        : `Image${subset.length === 1 ? '' : 's'} attached:`,
    },
  ];
  for (const p of prepared) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: p.mediaType, data: p.data },
    });
  }
  contentBlocks.push({
    type: 'text',
    text: 'Now return the JSON object with title and body.',
  });

  return generateDraft({ system, contentBlocks, timeoutMs: 120000 });
}
