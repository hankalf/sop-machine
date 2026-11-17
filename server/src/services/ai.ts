import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AppSettings, Category, LanguageOption, TranslatedContent } from '../../../shared/types';

type Mode = 'recording' | 'notes' | 'import';

const calloutTypes = ['none', 'danger', 'warning', 'caution', 'note', 'tip'] as const;

const baseStep = {
  kind: z.enum(['step', 'section']),
  title: z.string(),
  instructions: z.string(),
  callout_type: z.enum(calloutTypes),
  callout_text: z.string(),
};
const box = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

const base = {
  title: z.string(),
  purpose: z.string(),
  scope: z.string(),
  responsibilities: z.string(),
  safety: z.array(z.string()),
  tools: z.array(z.string()),
  notes: z.string(),
  tags: z.array(z.string()),
};

const RecordingSchema = z.object({ ...base, steps: z.array(z.object({ ...baseStep, frame: z.number().int(), highlight: box })) });
const NotesSchema = z.object({ ...base, steps: z.array(z.object(baseStep)) });
const ImportSchema = z.object({
  ...base,
  steps: z.array(z.object({ ...baseStep, images: z.array(z.number().int()) })),
  category_code: z.string(),
  original: z.object({ number: z.string(), version: z.string(), owner: z.string(), approver: z.string(), effective_date: z.string() }),
});

/** Normalized result used by the generator regardless of mode. */
export interface GeneratedSop {
  title: string;
  purpose: string;
  scope: string;
  responsibilities: string;
  safety: string[];
  tools: string[];
  notes: string;
  tags: string[];
  steps: {
    kind: 'step' | 'section';
    title: string;
    instructions: string;
    callout_type: (typeof calloutTypes)[number];
    callout_text: string;
    /** Indexes into the frames/images that were sent. */
    images: number[];
    highlight: z.infer<typeof box> | null;
  }[];
  categoryCode: string;
  original: { number: string; version: string; owner: string; approver: string; effectiveDate: string } | null;
}

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;

function jsonSchema(mode: Mode) {
  const stepProps: Record<string, unknown> = {
    kind: { type: 'string', enum: ['step', 'section'] },
    title: str,
    instructions: str,
    callout_type: { type: 'string', enum: calloutTypes },
    callout_text: str,
  };
  if (mode === 'recording') {
    stepProps.frame = { type: 'integer' };
    stepProps.highlight = {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } },
    };
  }
  if (mode === 'import') stepProps.images = { type: 'array', items: { type: 'integer' } };
  const props: Record<string, unknown> = {
    title: { type: 'string', description: 'Short SOP title, e.g. "Receive a Purchase Order in the WMS"' },
    purpose: str,
    scope: str,
    responsibilities: str,
    safety: strArr,
    tools: strArr,
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(stepProps), properties: stepProps } },
    notes: str,
    tags: strArr,
  };
  if (mode === 'import') {
    props.category_code = str;
    props.original = {
      type: 'object',
      additionalProperties: false,
      required: ['number', 'version', 'owner', 'approver', 'effective_date'],
      properties: { number: str, version: str, owner: str, approver: str, effective_date: { type: 'string', description: 'YYYY-MM-DD or empty' } },
    };
  }
  return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
}

function systemPrompt(settings: AppSettings): string {
  return `You are a senior technical writer who creates Standard Operating Procedures (SOPs) for warehouse and distribution-center operations: WMS/ERP and other computer systems, receiving, put-away, picking, shipping, trailer and dock operations, inventory control, material-handling equipment and safety.

The SOPs are used by frontline associates, including new hires and people reading in a second language, often under time pressure. They must be accurate, unambiguous and easy to follow.

House writing style: ${settings.ai.writingStyle}

Rules:
- One action per step. Start each step's instructions with a verb. Step titles are short (2-6 words), e.g. "Open the receiving screen".
- Put exact on-screen labels (buttons, fields, menus, tabs) and critical values in **bold**, copied exactly as they appear.
- Use "section" rows (kind "section", only a title) to group steps into phases when the process has natural phases. Skip sections for short procedures (fewer than about 6 steps).
- Use callouts only when they add value: danger (risk of serious injury), warning (risk of injury or major loss), caution (risk of damage, errors or rework), note (important information), tip (shortcut or best practice). Otherwise use callout_type "none" with empty callout_text.
- Do not invent facts. When something is unclear, keep the step generic and list what should be confirmed in "notes".
- Never copy passwords, personal data, or customer-identifying information into the SOP.
- purpose, scope, responsibilities and notes are short markdown: a sentence or two, or "- " bullet lists.
- safety lists PPE and hazards for physical work; leave it empty for pure computer tasks.
- tools lists equipment, devices and software (e.g. "WMS – Receiving module", "Zebra label printer", "RF scanner").
- tags are 2-6 short lowercase keywords.${settings.ai.extraInstructions.trim() ? `\n\nAdditional instructions from the administrator:\n${settings.ai.extraInstructions.trim()}` : ''}`;
}

export interface FrameInput {
  data: Buffer;
  width: number;
  height: number;
  label: string;
}

export interface GenerationContext {
  /** Timed transcript of the narration, when the recording has spoken explanation. */
  narration?: string;
  recordingType: 'screen' | 'physical';
  systemName: string;
  processName: string;
  audience: string;
  notes: string;
}

function contextLines(c: GenerationContext): string {
  const lines = [
    c.systemName && `- System / equipment: ${c.systemName}`,
    c.processName && `- Process: ${c.processName}`,
    c.audience && `- Performed by: ${c.audience}`,
    c.notes && `- Notes from the author: ${c.notes}`,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : '- (none provided)';
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 3, timeout: 15 * 60 * 1000 }));

async function callClaude(
  settings: AppSettings,
  mode: Mode | 'translate',
  content: Anthropic.Beta.BetaContentBlockParam[],
  schemaOverride?: Record<string, unknown>,
  systemOverride?: string,
): Promise<unknown> {
  if (!isAiConfigured()) {
    throw new Error('AI is not configured. Add an ANTHROPIC_API_KEY variable to the Railway service.');
  }
  try {
    const stream = getClient().beta.messages.stream({
      model: settings.ai.model,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: {
        effort: settings.ai.effort,
        format: { type: 'json_schema', schema: schemaOverride ?? jsonSchema(mode as Mode) },
      },
      system: systemOverride ?? systemPrompt(settings),
      messages: [{ role: 'user', content }],
    });
    const message = await stream.finalMessage();
    console.log(`[ai] mode=${mode} model=${message.model} stop=${message.stop_reason} in=${message.usage.input_tokens} out=${message.usage.output_tokens}`);
    if (message.stop_reason === 'refusal') {
      throw new Error(`The AI declined to process this content${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('The AI response was too long. Try a shorter recording or document.');
    }
    const text = message.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
    if (!text) throw new Error('The AI returned no content.');
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The AI service is rate limited right now. Try again in a few minutes.');
    if (err instanceof Anthropic.BadRequestError) throw new Error(`The AI request was rejected: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new Error(`AI service error (${err.status ?? 'network'}): ${err.message}`);
    throw err;
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`The AI response was not in the expected format: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

const common = (g: z.infer<typeof NotesSchema>) => ({
  title: g.title,
  purpose: g.purpose,
  scope: g.scope,
  responsibilities: g.responsibilities,
  safety: g.safety,
  tools: g.tools,
  notes: g.notes,
  tags: g.tags,
});

function addImages(content: Anthropic.Beta.BetaContentBlockParam[], images: FrameInput[], noun: 'Frame' | 'Image') {
  images.forEach((f, i) => {
    content.push({ type: 'text', text: `${noun} ${i} — ${f.label} — ${f.width}×${f.height} px` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data.toString('base64') } });
  });
}

/** Screen recording or video → SOP. Frames are in time order. */
export async function sopFromFrames(settings: AppSettings, frames: FrameInput[], ctx: GenerationContext): Promise<GeneratedSop> {
  const intro =
    ctx.recordingType === 'screen'
      ? `Create an SOP from this screen recording of someone using a computer system. I extracted ${frames.length} key frames in time order; the mouse pointer shows where they were working.`
      : `Create an SOP from this video of a physical warehouse task (not a computer screen). I extracted ${frames.length} key frames in time order.`;
  const target =
    ctx.recordingType === 'screen'
      ? 'the UI element (button, field, menu item, tab) the associate must click or type into in that step'
      : 'the key object for that step (for example the wheel chock, dock lock light, seal, or control)';
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: 'text',
      text: `${intro}

Context from the author:
${contextLines(ctx)}

${
  ctx.narration
    ? `The author narrated while recording. Timed transcript (times match the frame labels):
<narration>
${ctx.narration}
</narration>
Use the narration for intent, values, warnings and tips that are not visible on screen, and turn spoken cautions into callouts. It comes from speech recognition, so ignore filler words and obvious recognition errors.

`
    : ''
}For each step:
- "frame": the index of the frame that best shows the moment the associate performs the step (for screens, usually the frame just before the action, where the target is visible). Use -1 when no frame fits. Use each frame for at most one step, and give most steps a frame.
- "highlight": a tight bounding box in that frame's pixel coordinates around ${target}. Use all zeros when there is no single target or when frame is -1.
Skip frames that only show transitions, loading screens or repeated content.`,
    },
  ];
  addImages(content, frames, 'Frame');
  const g = parse(RecordingSchema, await callClaude(settings, 'recording', content));
  return {
    ...common(g),
    steps: g.steps.map((s) => ({ ...s, images: s.frame >= 0 ? [s.frame] : [], highlight: s.highlight.width > 0 && s.highlight.height > 0 ? s.highlight : null })),
    categoryCode: '',
    original: null,
  };
}

/** Rough notes or a description → SOP. */
export async function sopFromText(settings: AppSettings, input: { text: string; pdf?: Buffer; ctx: GenerationContext }): Promise<GeneratedSop> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.toString('base64') } });
  content.push({
    type: 'text',
    text: `Turn the following material into a complete, well-structured SOP. It may be rough notes, an existing procedure, or a description of how the task is done. Keep all real details (system names, screen labels, locations, values), fix gaps in order and wording, and follow the rules.

Context from the author:
${contextLines(input.ctx)}
${input.text.trim() ? `\nMaterial:\n<material>\n${input.text.trim()}\n</material>` : input.pdf ? '\nThe material is the attached document.' : ''}`,
  });
  const g = parse(NotesSchema, await callClaude(settings, 'notes', content));
  return { ...common(g), steps: g.steps.map((s) => ({ ...s, images: [], highlight: null })), categoryCode: '', original: null };
}

/**
 * An existing SOP (PDF, Word or text) → the same content in our unified structure.
 * Images extracted from the original are numbered so they can be placed on the right steps.
 */
export async function sopFromExistingDocument(
  settings: AppSettings,
  input: { fileName: string; pdf?: Buffer; text?: string; images: FrameInput[]; categories: Category[] },
): Promise<GeneratedSop> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.toString('base64') }, title: input.fileName });
  const categoryList = input.categories.map((c) => `- ${c.code}: ${c.name}${c.description ? ` (${c.description})` : ''}`).join('\n');
  content.push({
    type: 'text',
    text: `Convert this existing SOP ("${input.fileName}") into our standard SOP structure.

This is a conversion, not a rewrite of the procedure:
- Keep every step, value, location, system name, screen label and safety requirement from the original. Do not drop content and do not add steps that are not supported by the original.
- Map the original's sections onto ours (purpose, scope, responsibilities, safety, tools, steps, notes). Put anything that does not fit (definitions, references, forms, related documents) in "notes".
- Split long paragraphs into one-action steps and tighten wording to the house style, but keep the meaning exactly.
- Ignore the original's cover page, headers, footers, page numbers, logos, tables of contents, signature blocks and revision tables, except to fill "original".
- "original": the document number, revision/version, owner/author, approver and effective date printed on the original. Use empty strings for anything not stated.
- "category_code": the best matching code from this list, or an empty string if none fits:
${categoryList || '- (no categories defined)'}
${
  input.images.length
    ? `- "images": I extracted ${input.images.length} images from the original, numbered below in document order${input.text ? ' (their positions are marked [[IMAGE n]] in the text)' : ' with the page they came from'}. For each step list the indexes of the images that belong to it, usually the screenshot or photo next to that step in the original. Leave out logos, QR codes, signatures, icons and decorative images. Each image belongs to at most one step.`
    : '- "images": always an empty list (no images were extracted).'
}
${input.text ? `\nOriginal document text:\n<document>\n${input.text}\n</document>` : ''}`,
  });
  addImages(content, input.images, 'Image');
  const g = parse(ImportSchema, await callClaude(settings, 'import', content));
  return {
    ...common(g),
    steps: g.steps.map((s) => ({ ...s, images: s.images, highlight: null })),
    categoryCode: g.category_code,
    original: {
      number: g.original.number,
      version: g.original.version,
      owner: g.original.owner,
      approver: g.original.approver,
      effectiveDate: g.original.effective_date,
    },
  };
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

const TranslationSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  scope: z.string(),
  responsibilities: z.string(),
  notes: z.string(),
  safety: z.array(z.string()),
  tools: z.array(z.string()),
  steps: z.array(z.object({ id: z.string(), title: z.string(), body: z.string(), callout: z.string(), captions: z.array(z.string()) })),
  attachments: z.array(z.string()),
  checklistFields: z.array(z.string()),
  strings: z.record(z.string(), z.string()),
});

function translationSchema(stringKeys: string[]) {
  const arr = { type: 'array', items: { type: 'string' } };
  const strProps = Object.fromEntries(stringKeys.map((k) => [k, { type: 'string' }]));
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'purpose', 'scope', 'responsibilities', 'notes', 'safety', 'tools', 'steps', 'attachments', 'checklistFields', 'strings'],
    properties: {
      title: { type: 'string' },
      purpose: { type: 'string' },
      scope: { type: 'string' },
      responsibilities: { type: 'string' },
      notes: { type: 'string' },
      safety: arr,
      tools: arr,
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'body', 'callout', 'captions'],
          properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, callout: { type: 'string' }, captions: arr },
        },
      },
      attachments: arr,
      checklistFields: arr,
      strings: { type: 'object', additionalProperties: false, required: stringKeys, properties: strProps },
    },
  };
}

/** Translate an SOP's text (and the fixed document wording) for frontline associates. */
export async function translateSop(
  settings: AppSettings,
  source: { content: TranslatedContent; strings: Record<string, string> },
  language: LanguageOption,
): Promise<{ content: TranslatedContent; strings: Record<string, string> }> {
  const system = `You translate warehouse Standard Operating Procedures from English into ${language.name} (${language.native}) for frontline associates.

Rules:
- Plain, natural ${language.name} at a basic reading level, in the same direct, imperative style as the English.
- Translate faithfully. Do not add, drop or soften any step, value, warning or safety requirement.
- Keep markdown exactly as in the source: **bold**, *italic*, "- " and "1. " lists, line breaks.
- Software labels in **bold** (buttons, fields, menus, screen names) stay in English because the screen shows them that way. Add the translation in parentheses after the first mention in each step, e.g. **Confirm Receipt** (Confirmar recepción).
- Keep SOP numbers, item and location codes, units, model numbers, acronyms (WMS, LPN, PPE…) and product or system names unchanged.
- Keep every step "id" exactly, and keep every list the same length and order as the source. Empty strings stay empty.
- "strings" are fixed labels printed on the document. Translate each one; keep placeholders like {company} or {title} unchanged and keep the callout words (DANGER, WARNING, CAUTION, NOTE, TIP) in capitals.${
    settings.languages.glossary.trim() ? `\n\nGlossary and preferences from the administrator:\n${settings.languages.glossary.trim()}` : ''
  }`;
  const payload = { ...source.content, strings: source.strings };
  const raw = await callClaude(
    settings,
    'translate',
    [{ type: 'text', text: `Translate this SOP into ${language.name}.\n<source>\n${JSON.stringify(payload, null, 1)}\n</source>` }],
    translationSchema(Object.keys(source.strings)),
    system,
  );
  const parsed = TranslationSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`The translation was not in the expected format: ${parsed.error.issues[0]?.message}`);
  const { strings, ...content } = parsed.data;
  return { content, strings };
}
