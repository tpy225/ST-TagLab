/**
 * Bot 客户端(OpenAI 兼容 chat completions,自配接口)。
 *
 * 与 NAI 直连同口径:浏览器 fetch,无服务器代理;逐个消息非流式返回。
 * 端点拼接:baseUrl 已以 /chat/completions 结尾则原样使用,否则补 /chat/completions,
 * 兼容「只填 https://api.openai.com/v1」与「填完整地址」两种习惯。
 */
import { activeBotProfile } from '@/state/settings';

export class BotError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BotError';
  }
}

export interface BotMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 归一 baseUrl(去尾部斜杠;空则抛错)。 */
function baseOf(baseUrl: string): string {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new BotError('请先在设置里填写 Bot 接口地址');
  return base;
}

/** 拼 chat completions 端点。 */
export function botEndpoint(baseUrl: string): string {
  const base = baseOf(baseUrl);
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

/** 拼 /models 端点(拉取可用模型)。 */
function modelsEndpoint(baseUrl: string): string {
  const base = baseOf(baseUrl);
  if (base.endsWith('/chat/completions')) return `${base.slice(0, -'/chat/completions'.length)}/models`;
  return `${base}/models`;
}

async function httpError(resp: Response): Promise<BotError> {
  const text = (await resp.text().catch(() => '')).trim();
  let detail = text;
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    detail = json?.error?.message ?? json?.message ?? text;
  } catch {
    /* 非 JSON 错误体直接用原文 */
  }
  const msg = `${resp.status}:${detail.slice(0, 300)}`;
  if (resp.status === 401) return new BotError('Bot API Key 错误或无效', resp.status);
  if (resp.status === 429) return new BotError('Bot 请求过于频繁(429),稍后再试', resp.status);
  return new BotError(`Bot 调用失败 ${msg}`, resp.status);
}

/**
 * 发一轮对话(含完整历史),返回 assistant 的文本回复。
 * 非流式;单条消息、手动测试场景够用。
 */
export async function chat(messages: BotMessage[], signal?: AbortSignal): Promise<string> {
  const bot = activeBotProfile();
  const all: BotMessage[] = bot.systemPrompt.trim()
    ? [{ role: 'system', content: bot.systemPrompt.trim() }, ...messages]
    : messages;

  // 只出 tag、回复很短,不覆盖接口的温度/最大 Token 默认值
  const body: Record<string, unknown> = {
    model: bot.model,
    messages: all,
  };

  const resp = await fetch(botEndpoint(bot.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bot.key.trim()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw await httpError(resp);
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new BotError('Bot 返回了空回复');
  return content;
}

/** 拉取可用模型 id 列表(OpenAI 兼容 /models);可用草稿中的地址/Key 覆盖。 */
export async function listModels(
  override?: { baseUrl?: string; key?: string; signal?: AbortSignal },
): Promise<string[]> {
  const bot = activeBotProfile();
  const baseUrl = override?.baseUrl ?? bot.baseUrl;
  const key = override?.key ?? bot.key;
  const resp = await fetch(modelsEndpoint(baseUrl), {
    headers: { Authorization: `Bearer ${key.trim()}` },
    signal: override?.signal,
  });
  if (!resp.ok) throw await httpError(resp);
  const data = (await resp.json()) as { data?: { id?: unknown }[] };
  const ids = (data.data ?? [])
    .map(m => m.id)
    .filter((x): x is string => typeof x === 'string')
    .sort();
  if (!ids.length) throw new BotError('没有拉到任何模型');
  return ids;
}

/**
 * 从 Bot 回复里提取 tag 串(填提示词用)。
 * 只做最必要的清理:剥掉 Markdown 代码块围栏;其余按 Bot 原样(系统提示词已约束其只出 tag)。
 */
export function extractTags(text: string): string {
  let t = text;
  // 剥代码块:```lang\n … ``` 或单行 ```
  t = t.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');
  return t.replace(/\r\n?/g, ', ').replace(/\n+/g, ', ').replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
}