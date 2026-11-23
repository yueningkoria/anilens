/* AniLens — 动漫截图溯源 Demo */

const $ = (id) => document.getElementById(id);
const CFG_KEY = 'anilens.config.v1';
const HIS_KEY = 'anilens.history.v1';
const PROMPT_KEY = 'anilens.prompt.v1';
const HINT_KEY = 'anilens.hint.v1';
const MAX_HISTORY = 6;

/* 共享图库（Supabase）：填入 Project URL 与 anon key 后自动启用，缺少任一项则隐藏图库面板 */
const LIB_CONFIG = {
  url: '',
  key: '',
  bucket: 'library-thumbs',
  table: 'library'
};

const LIB_KIND_LABEL = { anime: '番剧', game: '游戏', illustration: '插画', other: '其他' };

const PRESETS = {
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  'deepseek-flash': {
    label: 'DeepSeek · deepseek-flash（视觉，推荐）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash'
  },
  'deepseek-chat': {
    label: 'DeepSeek · deepseek-chat（仅文本）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat'
  },
  'deepseek-reasoner': {
    label: 'DeepSeek · deepseek-reasoner（仅文本）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-reasoner'
  },
  dashscope: {
    label: '通义千问 DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max'
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-plus'
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash'
  },
  custom: { label: '自定义 / 中转接口', baseUrl: '', model: '' }
};

const state = {
  dataUrl: '',
  thumb: '',
  meta: '',
  imageUrl: '',
  busy: false,
  lastText: '',
  payload: null,
  reqToken: 0
};

/* ---------------- 基础工具 ---------------- */

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 2600);
}

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function joinUrl(base, path) {
  return String(base || '').replace(/\/+$/, '') + path;
}

/* ---------------- 配置 ---------------- */

function readConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch (e) {
    /* 忽略隐私模式写入失败 */
  }
}

function readPrompt() {
  try {
    return localStorage.getItem(PROMPT_KEY) || '';
  } catch (e) {
    return '';
  }
}

function savePrompt(value) {
  try {
    localStorage.setItem(PROMPT_KEY, value);
  } catch (e) {
    /* 忽略写入失败 */
  }
}

function readHint() {
  try {
    return localStorage.getItem(HINT_KEY) || '';
  } catch (e) {
    return '';
  }
}

function saveHint(value) {
  try {
    localStorage.setItem(HINT_KEY, value);
  } catch (e) {
    /* 忽略写入失败 */
  }
}

function currentConfig() {
  const cfg = readConfig();
  return {
    baseUrl: (cfg.baseUrl || '').trim(),
    model: (cfg.model || '').trim(),
    apiKey: (cfg.apiKey || '').trim(),
    online: cfg.online !== false
  };
}

function refreshBadge() {
  const cfg = currentConfig();
  const badge = $('keyBadge');
  if (cfg.apiKey && cfg.model) {
    badge.textContent = '已配置 · ' + cfg.model;
    badge.className = 'badge badge-on';
  } else {
    badge.textContent = '未配置模型';
    badge.className = 'badge badge-off';
  }
}

/* ---------------- 设置弹窗 ---------------- */

function buildPresetOptions() {
  const select = $('presetSelect');
  select.innerHTML = Object.keys(PRESETS)
    .map((key) => '<option value="' + key + '">' + esc(PRESETS[key].label) + '</option>')
    .join('');
}

function openSettings() {
  const cfg = currentConfig();
  const normBase = (value) => String(value || '').replace(/\/+$/, '').replace(/\/v1$/i, '').toLowerCase();
  const matched = Object.keys(PRESETS).find(
    (key) => PRESETS[key].baseUrl && normBase(PRESETS[key].baseUrl) === normBase(cfg.baseUrl) && PRESETS[key].model === cfg.model
  );
  $('presetSelect').value = matched || (cfg.baseUrl ? 'custom' : 'siliconflow');
  $('baseUrl').value = cfg.baseUrl || PRESETS.siliconflow.baseUrl;
  $('modelName').value = cfg.model || PRESETS.siliconflow.model;
  $('apiKey').value = cfg.apiKey || '';
  $('onlineToggle').checked = cfg.online !== false;
  $('testResult').textContent = '';
  $('testResult').className = 'modal-note';
  $('settingsModal').hidden = false;
  setTimeout(() => $('apiKey').focus(), 50);
}

function closeSettings() {
  $('settingsModal').hidden = true;
}

function collectSettings() {
  return {
    baseUrl: $('baseUrl').value.trim(),
    model: $('modelName').value.trim(),
    apiKey: $('apiKey').value.trim(),
    online: $('onlineToggle').checked
  };
}

async function handleSaveSettings() {
  const cfg = collectSettings();
  if (!cfg.baseUrl || !cfg.model) {
    toast('请填写接口地址与模型名称');
    return;
  }
  saveConfig(cfg);
  refreshBadge();
  closeSettings();
  toast('设置已保存到本机');
}

async function handleTest() {
  const cfg = collectSettings();
  const note = $('testResult');
  if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
    note.textContent = '请先填写接口地址、模型名称和 API Key。';
    note.className = 'modal-note err';
    return;
  }
  note.textContent = '正在测试连接…';
  note.className = 'modal-note';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text();
      note.textContent = '连接失败：' + apiErrorMessage(res.status, text);
      note.className = 'modal-note err';
      return;
    }
    note.textContent = '连接成功，模型可用。';
    note.className = 'modal-note ok';
  } catch (err) {
    note.textContent = '连接失败：' + networkErrorMessage(err);
    note.className = 'modal-note err';
  } finally {
    clearTimeout(timer);
  }
}

async function handleTestOnline() {
  const note = $('testResult');
  note.textContent = '正在连接 AniList…';
  note.className = 'modal-note';
  try {
    const data = await anilistQuery('query { Media(search: "進撃の巨人", type: ANIME) { id title { native } averageScore } }', {});
    const media = data && data.Media;
    if (!media) throw new Error('no result');
    note.textContent = '联网正常：AniList 可访问（示例条目：' + ((media.title && media.title.native) || '進撃の巨人') + '）。';
    note.className = 'modal-note ok';
  } catch (err) {
    note.textContent = '联网测试失败：无法访问 AniList，可能被网络限制。识别仍可使用，只是不会补充联网资料。';
    note.className = 'modal-note err';
  }
}

/* ---------------- 图片处理 ---------------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

async function drawToDataUrl(blob, maxSide, quality) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function applyImage(blob, label) {
  try {
    const big = await drawToDataUrl(blob, 1280, 0.85);
    const small = await drawToDataUrl(blob, 480, 0.7);
    state.dataUrl = big.dataUrl;
    state.thumb = small.dataUrl;
    state.meta = (label ? label + ' · ' : '') + big.width + '×' + big.height + ' · ' + formatBytes(blob.size || 0);
    renderPreview();
    $('btnAnalyze').disabled = false;
    $('btnTrace').disabled = false;
  } catch (err) {
    toast('图片读取失败，请换一张试试');
  }
}

function renderPreview() {
  if (!state.dataUrl) {
    $('dzEmpty').hidden = false;
    $('dzPreview').hidden = true;
    $('btnAnalyze').disabled = true;
    $('btnTrace').disabled = true;
    return;
  }
  $('previewImg').src = state.dataUrl;
  $('fileMeta').textContent = state.meta;
  $('dzEmpty').hidden = true;
  $('dzPreview').hidden = false;
}

function clearImage() {
  state.dataUrl = '';
  state.thumb = '';
  state.meta = '';
  state.imageUrl = '';
  renderPreview();
}

function handleFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast('请选择图片文件');
    return;
  }
  state.imageUrl = '';
  applyImage(file, file.name);
}

async function handleUrl() {
  const url = $('urlInput').value.trim();
  if (!url) {
    toast('请先粘贴图片链接');
    return;
  }
  toast('正在载入图片…');
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error('不是图片');
    await applyImage(blob, '网络图片');
    state.imageUrl = url;
  } catch (err) {
    toast('该链接无法读取，请下载后上传');
  }
}

/* ---------------- 状态提示 ---------------- */

function setBusy(busy, text) {
  state.busy = busy;
  $('statusPanel').hidden = !busy;
  if (text) $('statusText').textContent = text;
  const hasImage = Boolean(state.dataUrl);
  $('btnAnalyze').disabled = busy || !hasImage;
  $('btnTrace').disabled = busy || !hasImage;
  $('btnUrl').disabled = busy;
  $('btnAnalyze').classList.toggle('is-loading', busy);
  $('btnTrace').classList.toggle('is-loading', busy);
  $('btnAnalyze').textContent = busy ? '识别中…' : '用我的模型识别';
  $('btnTrace').textContent = busy ? '检索中…' : '免费溯源 · 交叉认证';
}

/* ---------------- 模型识别 ---------------- */

const SYSTEM_PROMPT = [
  '你是一位资深的二次元作品考据专家，擅长根据单张截图判断作品出处。',
  '请依据画风、角色特征、服装、构图、背景、UI 元素、字幕样式等线索，判断该图最可能出自哪部动画（番剧或剧场版）、游戏、漫画或插画作品。',
  '要求：',
  '1. 只依据图片可见内容推理，不要编造不存在的作品；没有把握时把 found 设为 false，并在 note 中说明。',
  '2. 给出最有把握的作品，并在 alternatives 中列出其他可能。',
  '3. 图中出现角色时尽量给出角色名；出现明显场景、剧情或关卡时简要描述。',
  '3.1 截图来自 Galgame / 视觉小说（立绘、事件 CG、对话框）时同样要识别：type 填「Galgame」或「视觉小说」，creator 填品牌或开发商，重点给出角色名与作品名；优先回忆品牌（如 ゆずソフト、Key、SAGA PLANETS、FAVORITE、Lump of Sugar）与画风、画师线索；title_original 必须是日文原名，brand 单独填写品牌；不确定也给出最可能的答案并降低 confidence。成人向作品只回答作品名、角色名与制作信息，不描述性内容。',
  '3.2 画面中有对话框、字幕或旁白时，把文字逐字转写到 dialogue 字段（保留原文语言，可含说话人），这是反查 Galgame 出处的关键线索；没有文字则留空字符串。',
  '4. 使用简体中文回答，作品与角色原名保留原文。',
  '5. character 必须识别图中最显眼的人物：给出角色名、原作、身份定位与外貌特征；无法确定人物时，name 与 original_name 留空字符串。',
  '6. similar_characters 给出 3 个与图中角色外貌、气质或设定相似的其他作品角色，并说明相似点；original_name 必须是日文或英文原名，便于联网检索。',
  '7. 可以先在内部推理（思考内容会在界面中折叠展示），但最终回复只包含一个 JSON 对象，不要输出 markdown 代码块、注释或 JSON 之外的任何文字。'
].join('\n');

const USER_PROMPT = [
  '请识别这张截图的出处，严格按以下 JSON 结构输出：',
  '{',
  '  "found": true,',
  '  "confidence": 0.0,',
  '  "title_cn": "作品中文名",',
  '  "title_original": "作品原文名（日文/英文）",',
  '  "type": "番剧 / 剧场版 / 游戏 / Galgame / 视觉小说 / 漫画 / 插画 / 其他",',
  '  "year": "首播或发售年份",',
  '  "creator": "制作公司 / 开发商 / 作者",',
  '  "brand": "品牌（Galgame / 视觉小说填写，如 ゆずソフト；其他类型可留空）",',
  '  "synopsis": "作品简介，2-3 句，概括设定与看点",',
  '  "characters": ["角色名"],',
  '  "character": {"name": "图中主要角色中文名", "original_name": "日文或英文原名", "from": "出自作品", "role": "身份/定位", "description": "外貌与服装特征", "confidence": 0.9},',
  '  "scene": "画面内容，以及可能的情节、关卡或场景",',
  '  "dialogue": "画面中的对白、字幕或旁白原文，没有则空字符串",',
  '  "evidence": "判断依据：画风、角色、服饰、UI、字幕等",',
  '  "keywords": ["用于搜索的关键词"],',
  '  "character_profile": {"hair": "发色", "eyes": "瞳色", "outfit": "服饰", "personality": ["性格标签"]},',
  '  "similar_characters": [{"name": "相似角色中文名", "original_name": "日文或英文原名", "from": "出自作品", "reason": "相似点"}],',
  '  "alternatives": [{"title": "备选作品名", "type": "类型", "reason": "为什么可能是它"}],',
  '  "note": "补充说明或不确定之处"',
  '}',
  '无法确定的字段填空字符串或空数组；confidence 为 0 到 1 之间的小数。'
].join('\n');

function buildUserPrompt() {
  const input = $('customPrompt');
  const extra = (input ? input.value : readPrompt()).trim();
  if (input) savePrompt(input.value);
  const hintInput = $('hintInput');
  const hint = (hintInput ? hintInput.value : readHint()).trim();
  if (hintInput) saveHint(hintInput.value);
  let prompt = USER_PROMPT;
  if (hint) {
    prompt += '\n\n已知线索（用户提供，必须优先满足；据此收窄范围，不要忽略）：\n' + hint;
  }
  if (extra) {
    prompt += '\n\n额外要求（用户自定义，优先遵循）：\n' + extra;
  }
  return prompt;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (content && typeof content.text === 'string') return content.text;
  return '';
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^\uFEFF/, '').trim();
  const candidates = [cleaned];

  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let fence;
  while ((fence = fenceRe.exec(cleaned))) candidates.push(fence[1].trim());

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(cleaned.slice(arrStart, arrEnd + 1));

  for (const candidate of candidates) {
    const direct = tryJsonParse(candidate);
    if (direct) return unwrapJson(direct);
    const repaired = tryJsonParse(repairJsonText(candidate));
    if (repaired) return unwrapJson(repaired);
  }
  return null;
}

function tryJsonParse(value) {
  try { return JSON.parse(value); } catch (e) { return null; }
}

function repairJsonText(value) {
  let text = String(value)
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  text = stripJsonComments(text);
  text = escapeRawControlChars(text);
  text = text.replace(/,\s*([}\]])/g, '$1');
  text = closeJsonBrackets(text);
  return text.replace(/,\s*([}\]])/g, '$1');
}

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

// 模型常在字符串里直接换行，导致 JSON 非法
function escapeRawControlChars(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

// 输出被截断时补齐未闭合的括号与字符串
function closeJsonBrackets(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inString) out += '"';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

function unwrapJson(value) {
  if (Array.isArray(value)) {
    return unwrapJson(value.find((item) => item && typeof item === 'object') || null);
  }
  if (typeof value === 'string') {
    const inner = tryJsonParse(value);
    if (inner) return unwrapJson(inner);
  }
  return value;
}

// 最后兜底：从纯文字里提取作品名与人物，避免直接报格式错误
function parseLooseResult(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const title = (raw.match(/《([^》]{1,40})》/) || [])[1] ||
    (raw.match(/(?:作品|番剧|动画|游戏|片名|出处)[：:]\s*([^，。；\s]{1,40})/) || [])[1] || '';
  const character = (raw.match(/(?:人物|角色)[：:]\s*([^，。；\s]{1,20})/) || [])[1] || '';
  const typeMatch = raw.match(/(番剧|动画|剧场版|游戏|手游|漫画|插画)/);
  if (!title && !character) return null;
  return {
    found: true,
    confidence: null,
    title_cn: title || character,
    title_original: '',
    type: typeMatch ? typeMatch[1] : '',
    synopsis: raw.slice(0, 200),
    characters: character ? [character] : [],
    keywords: [title || character].filter(Boolean),
    note: '模型未返回标准 JSON，已按文字内容容错解析'
  };
}

function apiErrorMessage(status, text) {
  let detail = '';
  try {
    const data = JSON.parse(text);
    detail = (data && data.error && (data.error.message || data.error.code)) || data.message || data.msg || '';
  } catch (e) {
    detail = String(text || '').slice(0, 200);
  }
  const suffix = detail ? '（' + detail + '）' : '';
  if (/image|vision|multimodal|does not support|unsupported/i.test(detail)) {
    return '该模型不支持图片输入，请改用视觉模型（DeepSeek 请填 deepseek-flash）' + suffix;
  }
  if (status === 400 && /model|not\s*found|不存在/i.test(detail)) {
    return '模型名称不可用，请检查模型名（DeepSeek 视觉模型为 deepseek-flash）' + suffix;
  }
  if (status === 401 || status === 403) return 'API Key 无效或没有该模型权限' + suffix;
  if (status === 404) return '接口地址或模型名称不存在，请检查 Base URL 与模型名' + suffix;
  if (status === 429) return '请求过于频繁或额度不足' + suffix;
  if (status >= 500) return '模型服务暂时不可用（HTTP ' + status + '）' + suffix;
  return '请求被拒绝（HTTP ' + status + '）' + suffix;
}

function networkErrorMessage(err) {
  if (err && err.name === 'AbortError') return '请求超时，请稍后重试';
  const detail = err && err.message ? '（' + err.message + '）' : '';
  return '无法连接接口。可能是网络问题、Base URL 有误，或该服务不允许浏览器直接调用（CORS）。可换用支持浏览器调用的服务，或使用中转地址。' + detail;
}

function isDeepSeekHost(baseUrl) {
  return /api\.deepseek\.com/i.test(String(baseUrl || ''));
}

// DeepSeek 的 chat / reasoner / coder 模型不支持图片，只有 flash 系列支持视觉
function isDeepSeekTextOnlyModel(model) {
  const name = String(model || '').trim().toLowerCase();
  if (name.indexOf('deepseek') === -1) return false;
  return !/flash|vision|-vl|vl2|multimodal/.test(name);
}

async function handleAnalyze() {
  if (!state.dataUrl || state.busy) return;
  const cfg = currentConfig();
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    openSettings();
    toast('请先配置模型 API Key');
    return;
  }

  setBusy(true, '正在调用视觉模型识别图片…');
  $('resultsPanel').hidden = true;

  if (isDeepSeekHost(cfg.baseUrl) && isDeepSeekTextOnlyModel(cfg.model)) {
    setBusy(false);
    showError('该 DeepSeek 模型不支持图片',
      'deepseek-chat / deepseek-reasoner 只能处理文本。请把模型名改为 deepseek-flash（DeepSeek 的视觉模型），或改用其他视觉模型。', 'analyze');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const url = joinUrl(cfg.baseUrl, '/chat/completions');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildUserPrompt() },
        { type: 'image_url', image_url: { url: state.dataUrl } }
      ]
    }
  ];

  try {
    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const firstText = await res.text();
      // 部分服务（含 DeepSeek 新版接口）不接受 temperature / max_tokens，去掉附加参数重试一次
      if (res.status === 400 || res.status === 422) {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + cfg.apiKey
          },
          body: JSON.stringify({ model: cfg.model, messages }),
          signal: controller.signal
        });
        if (!res.ok) {
          const retryText = await res.text();
          showError('模型调用失败', apiErrorMessage(res.status, retryText || firstText), 'analyze');
          return;
        }
      } else {
        showError('模型调用失败', apiErrorMessage(res.status, firstText), 'analyze');
        return;
      }
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      showError('接口返回异常', '接口没有返回 JSON，可能是中转服务返回了错误页。请检查 Base URL，或稍后重试。', 'analyze');
      return;
    }
    const choice = (data && data.choices && data.choices[0]) || {};
    const message = choice.message || {};
    const text = contentToText(message.content);
    const thinkingParts = [];
    const addThinking = (value) => {
      if (value && thinkingParts.indexOf(value) === -1) thinkingParts.push(value);
    };
    addThinking(contentToText(message.reasoning_content));

    if (!text && !thinkingParts.length) {
      showError('模型没有返回内容', choice.finish_reason === 'length'
        ? '输出长度被截断，模型把额度用在了推理上：请再试一次，或换用非推理型视觉模型。'
        : '请确认该模型支持图片输入（若为 DeepSeek，模型名请填 deepseek-flash）。', 'analyze');
      return;
    }

    let parsed = extractJson(text) || extractJson(thinkingParts.join('\n'));

    // 第二次：重新看图，明确要求只输出 JSON（解决“第二次识别不按 JSON”）
    if (!parsed) {
      setBusy(true, '正在重新整理识别结果…');
      const retry = await retryVisionJson(cfg, messages, controller.signal);
      if (retry) {
        addThinking(contentToText(retry.message.reasoning_content));
        parsed = extractJson(contentToText(retry.message.content)) ||
          extractJson(contentToText(retry.message.reasoning_content));
      }
    }

    // 第三次：让模型把已有输出改写成 JSON
    if (!parsed) {
      const source = text || thinkingParts.join('\n');
      if (source) parsed = await repairJsonOutput(source, cfg, controller.signal);
    }

    // 最后：按文字内容做最小化容错解析
    if (!parsed) parsed = parseLooseResult(text || thinkingParts.join('\n'));

    if (!parsed || typeof parsed !== 'object') {
      showError('模型输出格式异常', '连续尝试后仍未拿到 JSON 结果。可以点重试，或换用支持 JSON 输出的视觉模型。', 'analyze');
      return;
    }

    // 低置信度时裁掉底部对话框再识别一次，取更可信的结果
    if (parsed.found === false || confidenceOf(parsed) < 0.65) {
      const cropped = await cropDialogArea(state.dataUrl);
      if (cropped) {
        setBusy(true, '把握不足，正在裁掉对话框二次识别…');
        const second = await requestVisionPass(cfg, cropped, controller.signal);
        if (second && second.parsed) {
          addThinking(second.thinking);
          if (confidenceOf(second.parsed) > confidenceOf(parsed)) parsed = second.parsed;
        }
      }
    }

    const thinking = thinkingParts.join('\n\n');
    renderModelResult(parsed, cfg.model, thinking);
    addHistory({
      kind: 'model',
      title: parsed.title_cn || parsed.title_original || '未确定作品',
      subtitle: parsed.type || '模型识别',
      payload: { kind: 'model', data: parsed, model: cfg.model, thinking }
    });
  } catch (err) {
    console.error(err);
    showError('请求失败', networkErrorMessage(err), 'analyze');
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
}

/* ---------------- 结果渲染 ---------------- */

function confidenceOf(result) {
  const raw = result && result.confidence;
  const value = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!isFinite(value)) return 0;
  return value > 1 ? value / 100 : value;
}

// 裁掉底部约四分之一的对话框区域并放大，用于二次识别
function cropDialogArea(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cut = Math.round(img.naturalHeight * 0.26);
        const height = Math.max(1, img.naturalHeight - cut);
        const scale = Math.min(1.6, 1400 / Math.max(img.naturalWidth, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, img.naturalWidth, height, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch (err) {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

async function requestVisionPass(cfg, imageDataUrl, signal) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildUserPrompt() + '\n\n补充说明：这张图已裁掉底部对话框，请重点依据立绘、CG 中的人物、画风与配色判断；优先给出 Galgame 品牌与角色名。'
        },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }
  ];
  try {
    let res = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages
      }),
      signal
    });
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      res = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, messages }),
        signal
      });
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const message = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
    let thinking = contentToText(message.reasoning_content);
    let parsed = extractJson(contentToText(message.content)) || extractJson(thinking);
    if (!parsed) {
      const retry = await retryVisionJson(cfg, messages, signal);
      if (retry) {
        thinking += '\n' + contentToText(retry.message.reasoning_content);
        parsed = extractJson(contentToText(retry.message.content)) ||
          extractJson(contentToText(retry.message.reasoning_content));
      }
    }
    if (!parsed) parsed = parseLooseResult(contentToText(message.content) || thinking);
    return parsed ? { parsed, thinking } : null;
  } catch (err) {
    return null;
  }
}

async function retryVisionJson(cfg, messages, signal) {
  const retryMessages = messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    const content = Array.isArray(message.content)
      ? message.content.slice()
      : [{ type: 'text', text: String(message.content || '') }];
    content.push({
      type: 'text',
      text: '重要：这次最终回复只能是一个 JSON 对象，不要输出思考过程、解释或代码块；无法确定时把 found 设为 false。'
    });
    return { role: message.role, content };
  });
  const doFetch = (body) => fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey
    },
    body: JSON.stringify(body),
    signal
  });
  try {
    let res = await doFetch({
      model: cfg.model,
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: retryMessages
    });
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      res = await doFetch({ model: cfg.model, messages: retryMessages });
    }
    if (!res.ok) return null;
    const data = await res.json();
    const message = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
    return { message };
  } catch (err) {
    return null;
  }
}

async function repairJsonOutput(raw, cfg, signal) {
  const schema = '{"found":true,"confidence":0,"title_cn":"","title_original":"","type":"","year":"","creator":"","brand":"","synopsis":"","characters":[],"character":{"name":"","original_name":"","from":"","role":"","description":"","confidence":0},"scene":"","evidence":[],"keywords":[],"character_profile":{"hair":"","eyes":"","outfit":"","personality":[]},"similar_characters":[],"alternatives":[],"note":""}';
  const messages = [
    { role: 'system', content: '你是 JSON 转换器，只输出一个严格合法的 JSON 对象，不要输出解释或代码块。' },
    {
      role: 'user',
      content: '把下面的识别结果整理为严格合法的 JSON，字段缺失时留空，不要新增事实。' +
        '要求：只输出 JSON；字符串内不要出现未转义换行；不要使用中文引号；不要输出代码块或解释。\nJSON 结构：' + schema +
        '\n\n原始内容：\n' + raw.slice(0, 6000)
    }
  ];
  const doFetch = (body) => fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey
    },
    body: JSON.stringify(body),
    signal
  });
  try {
    let res = await doFetch({
      model: cfg.model,
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages
    });
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      res = await doFetch({ model: cfg.model, messages });
    }
    if (!res.ok) return null;
    const data = await res.json();
    const message = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
    return extractJson(contentToText(message.content) || contentToText(message.reasoning_content));
  } catch (err) {
    return null;
  }
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace('%', ''));
    if (isNaN(parsed)) return null;
    return parsed <= 1 ? Math.round(parsed * 100) : Math.round(parsed);
  }
  const num = Number(value);
  if (isNaN(num)) return null;
  return num <= 1 ? Math.round(num * 100) : Math.round(num);
}

function searchLinks(title, type) {
  const q = encodeURIComponent(title);
  const vndb = { label: 'VNDB', href: 'https://vndb.org/v?q=' + q };
  const moe = { label: '萌娘百科', href: 'https://zh.moegirl.org.cn/index.php?search=' + q };
  const moehui = { label: '萌绘', href: 'https://www.moehui.com/?s=' + q };
  const bgm = { label: 'Bangumi', href: 'https://bgm.tv/subject_search/' + q };
  const bili = { label: 'Bilibili', href: 'https://search.bilibili.com/all?keyword=' + q };
  const steam = { label: 'Steam', href: 'https://store.steampowered.com/search/?term=' + q };
  const google = { label: 'Google', href: 'https://www.google.com/search?q=' + q };
  const kind = String(type || '');
  if (/galgame|视觉小说|avg|eroge|恋爱冒险/i.test(kind)) return [vndb, moe, moehui, bgm, bili, google];
  if (/游戏|手游|主机/i.test(kind)) return [steam, moe, vndb, moehui, bgm, bili, google];
  return [moe, moehui, bgm, vndb, bili, steam, google];
}

function reverseSearchLinks() {
  if (state.imageUrl) {
    const q = encodeURIComponent(state.imageUrl);
    return [
      { label: 'IQDB', href: 'https://iqdb.org/?url=' + q },
      { label: 'ascii2d 色合', href: 'https://ascii2d.net/search/url/' + q },
      { label: 'ascii2d 特征', href: 'https://ascii2d.net/search/url/' + q },
      { label: 'Google Lens', href: 'https://lens.google.com/uploadbyurl?url=' + q },
      { label: 'Yandex 图片', href: 'https://yandex.com/images/search?rpt=imageview&url=' + q }
    ];
  }
  return [
    { label: 'IQDB', href: 'https://iqdb.org/' },
    { label: 'ascii2d 色合', href: 'https://ascii2d.net/' },
    { label: 'ascii2d 特征', href: 'https://ascii2d.net/' },
    { label: 'Google Lens', href: 'https://lens.google.com/' },
    { label: 'Yandex 图片', href: 'https://yandex.com/images/' }
  ];
}

function reverseSearchHtml() {
  const note = state.imageUrl
    ? '<p class="online-note">使用当前图片直链搜索，无需重新上传。ascii2d 打开后可在顶部切换「色合検索 / 特徴検索」，原图未调色用色合，裁切或调色过用特征。</p>'
    : '<p class="online-note">本地图片需在站点内手动上传：浏览器不允许网页直接提交本地文件。ascii2d 上传后可切换「色合検索 / 特徴検索」。</p>';
  const links = reverseSearchLinks().map((item) =>
    '<a href="' + esc(item.href) + '" target="_blank" rel="noopener">在 ' + esc(item.label) + ' 搜图</a>'
  ).join('');
  return '<div class="block"><h3>以图搜图</h3><div class="search-row">' + links + '</div>' + note + '</div>';
}

function dialogueBlockHtml(text) {
  const line = String(text).replace(/\s+/g, ' ').trim();
  if (!line) return '';
  const snippet = line.slice(0, 60);
  const google = 'https://www.google.com/search?q=' + encodeURIComponent('"' + snippet + '"');
  const bing = 'https://www.bing.com/search?q=' + encodeURIComponent('"' + snippet + '"');
  const moe = 'https://zh.moegirl.org.cn/index.php?search=' + encodeURIComponent(snippet.slice(0, 40));
  return '<div class="block"><h3>台词线索</h3><p>' + esc(line) + '</p>' +
    '<div class="search-row">' +
    '<a href="' + esc(google) + '" target="_blank" rel="noopener">用台词搜 Google</a>' +
    '<a href="' + esc(bing) + '" target="_blank" rel="noopener">搜 Bing</a>' +
    '<a href="' + esc(moe) + '" target="_blank" rel="noopener">搜 萌娘百科</a>' +
    '</div><p class="online-note">Galgame 的对白常被攻略站、百科或论坛收录，用台词反查往往比识图更准。</p></div>';
}

function renderModelResult(data, model, thinking) {
  const confidence = normalizeConfidence(data.confidence);
  const titleCn = data.title_cn || data.title_original || '未能确定作品';
  const characters = Array.isArray(data.characters) ? data.characters.filter(Boolean) : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords.filter(Boolean) : [];
  const alternatives = Array.isArray(data.alternatives) ? data.alternatives.filter(Boolean) : [];
  const found = data.found !== false;

  let html = '';

  if (thinking) {
    const shown = thinking.length > 4000 ? thinking.slice(0, 4000) + '\n…（其余思考内容已省略）' : thinking;
    html += '<details class="thinking-box"><summary>思考过程（默认收起）</summary><pre>' + esc(shown) + '</pre></details>';
  }

  if (found === false) {
    html += '<div class="empty-state"><strong>未能确认出处</strong><p>' +
      esc(data.note || '模型没有足够把握判断这张图的来源，可以换用更专业的视觉模型，或试试下方的以图搜图。') +
      '</p></div>';
    html += '<div id="characterBlock" class="online-block"></div>';
    if (data.dialogue) html += dialogueBlockHtml(data.dialogue);
    const query = String(data.title_cn || (keywords[0] || '') || (data.character && data.character.name) || '').trim();
    if (query) {
      html += '<div class="block"><h3>进一步查证</h3><div class="search-row">' +
        searchLinks(query, data.type).map((l) => '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">在 ' + esc(l.label) + ' 搜索</a>').join('') +
        '</div></div>';
    }
    html += '<div id="vndbBlock" class="block"></div>';
    html += reverseSearchHtml();
  } else {
    html += '<div class="result-hero">';
    html += '<div class="result-head"><div>';
    html += '<p class="result-type">' + esc(data.type || '未知类型') + (data.year ? ' · ' + esc(data.year) : '') + '</p>';
    html += '<h2 class="result-title">' + esc(titleCn) + '</h2>';
    if (data.title_original && data.title_original !== titleCn) {
      html += '<p class="result-original">' + esc(data.title_original) + '</p>';
    }
    html += '</div>';
    if (confidence !== null) {
      html += '<div class="confidence"><b>' + confidence + '<span>%</span></b><small>模型置信度</small>' +
        '<div class="conf-bar"><i style="width:' + Math.min(100, Math.max(2, confidence)) + '%"></i></div></div>';
    }
    html += '</div>';

    const meta = [];
    if (data.creator) meta.push(['制作 / 开发', data.creator]);
    if (data.year) meta.push(['年份', data.year]);
    if (data.type) meta.push(['类型', data.type]);
    if (characters.length) meta.push(['角色', characters.join('、')]);
    if (meta.length) {
      html += '<dl class="meta-grid">' + meta.map((item) =>
        '<div class="meta-item"><dt>' + esc(item[0]) + '</dt><dd>' + esc(item[1]) + '</dd></div>'
      ).join('') + '</dl>';
    }
    html += '</div>';

    html += '<div id="characterBlock" class="online-block"></div>';

    html += '<div id="synopsisBlock" class="online-block"></div>';

    html += '<div id="onlineBlock" class="online-block">' + onlineSkeletonHtml() + '</div>';

    if (data.scene) {
      html += '<div class="block"><h3>画面场景</h3><p>' + esc(data.scene) + '</p></div>';
    }
    if (data.evidence) {
      html += '<div class="block"><h3>判断依据</h3><p>' + esc(data.evidence) + '</p></div>';
    }
    if (keywords.length) {
      html += '<div class="block"><h3>搜索关键词</h3><div class="chip-row">' +
        keywords.map((k) => '<span class="chip cyan">' + esc(k) + '</span>').join('') + '</div></div>';
    }
    if (data.note) {
      html += '<div class="block"><h3>备注</h3><p>' + esc(data.note) + '</p></div>';
    }
    if (data.dialogue) html += dialogueBlockHtml(data.dialogue);
    html += '<div class="block"><h3>进一步查证</h3><div class="search-row">' +
      searchLinks(titleCn, data.type).map((l) => '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">在 ' + esc(l.label) + ' 搜索</a>').join('') +
      '</div></div>';
    html += '<div id="vndbBlock" class="block"></div>';
    html += reverseSearchHtml();
  }

  if (alternatives.length) {
    html += '<div class="block"><h3>其他可能</h3><div class="alts">' + alternatives.map((alt) => {
      const name = alt && (alt.title || alt.name) ? (alt.title || alt.name) : '';
      const reason = alt && (alt.reason || alt.note) ? (alt.reason || alt.note) : '';
      const type = alt && alt.type ? alt.type : '';
      return '<div class="alt-item"><span><strong>' + esc(name || '未知') + '</strong>' +
        (type ? ' <span class="chip">' + esc(type) + '</span>' : '') + '</span>' +
        (reason ? '<em>' + esc(reason) + '</em>' : '') + '</div>';
    }).join('') + '</div></div>';
  }

  state.reqToken += 1;
  state.payload = { kind: 'model', data, model };
  state.lastText = modelResultToText(data, model);
  $('resultSource').textContent = '模型 · ' + (model || 'vision');
  $('resultSource').className = 'badge badge-info';
  $('resultBody').innerHTML = html;
  showResults();
  renderSynopsis(data, null);
  renderCharacterBlock(data, null);
  if (found !== false) enhanceOnline(data);
  else {
    findVnMatch(data).then((match) => {
      if (!match) return;
      const hit = match.best && match.best.character ? vndbHit(match.best.character) : null;
      renderCharacterBlock(data, hit);
      if (match.best && !hit) {
        findVnCharacter(data, match.best.vn).then((charHit) => {
          if (charHit) renderCharacterBlock(data, charHit);
        }).catch(() => {});
      }
      renderVnResult(match);
    }).catch(() => {});
  }
}

function renderCharacterBlock(data, hit) {
  const el = $('characterBlock');
  if (!el) return;
  const c = data && data.character;
  const name = c && (c.name || c.original_name);
  if (!name) {
    el.innerHTML = '';
    return;
  }
  const nativeName = hit && hit.name ? (hit.name.native || hit.name.full) : '';
  const display = name || nativeName;
  const avatar = hit && hit.image && hit.image.large
    ? '<img src="' + esc(hit.image.large) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '<span class="person-initial">' + esc(display.slice(0, 1)) + '</span>';
  const origin = [c.from ? '出自《' + c.from + '》' : '', c.role].filter(Boolean).join(' · ');
  const conf = typeof c.confidence === 'number'
    ? Math.round(Math.max(0, Math.min(1, c.confidence)) * 100) + '% 置信度'
    : '';
  const inner = '<div class="person-avatar">' + avatar + '</div>' +
    '<div class="person-info"><strong>' + esc(display) +
    (nativeName && nativeName !== display ? ' <em>' + esc(nativeName) + '</em>' : '') + '</strong>' +
    (origin ? '<span class="person-from">' + esc(origin) + '</span>' : '') +
    (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
    (hit && hit.source === 'vndb' ? '<span class="person-conf">VNDB 角色档案</span>' : '') +
    (conf ? '<span class="person-conf">' + esc(conf) + '</span>' : '') + '</div>';
  const href = hit && hit.siteUrl ? ' href="' + esc(hit.siteUrl) + '" target="_blank" rel="noopener"' : '';
  const tag = href ? 'a' : 'div';
  el.innerHTML = '<div class="online-head"><span class="online-dot"></span>图中人物</div>' +
    '<' + tag + ' class="person-card"' + href + '>' + inner + '</' + tag + '>';
}

function renderSynopsis(data, steam) {
  const el = $('synopsisBlock');
  if (!el) return;
  const syn = String((data && data.synopsis) || '').trim();
  const cover = steam && steam.cover;
  const desc = syn || (steam && steam.desc) || '';
  if (!desc && !cover) {
    el.innerHTML = '';
    return;
  }
  const linkLabel = (steam && steam.linkLabel) || '在 Steam 商店查看 →';
  let html = '<div class="online-head"><span class="online-dot"></span>作品简介</div>';
  if (cover) {
    html += '<div class="media-card">' +
      '<img class="media-cover" src="' + esc(cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' +
      '<div class="media-info"><h3>' + esc((steam && steam.title) || data.title_cn || '') + '</h3>' +
      (desc ? '<p class="media-desc">' + esc(desc) + '</p>' : '') +
      '<a class="media-link" href="' + esc(steam.href) + '" target="_blank" rel="noopener">' + esc(linkLabel) + '</a>' +
      '</div></div>';
  } else {
    html += '<div class="block"><p class="media-desc">' + esc(desc) + '</p></div>';
  }
  el.innerHTML = html;
  if (desc && needsZh(desc)) {
    translateToZh(desc).then((zh) => {
      if (!zh || zh === desc) return;
      const node = el.querySelector('.media-desc');
      if (node) node.textContent = zh;
    });
  }
}

function isGameType(type) {
  return /游戏|game|手游|端游|galgame|主机|网游/i.test(String(type || ''));
}

async function findVnCharacter(data, vn) {
  const terms = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (text && terms.indexOf(text) === -1) terms.push(text);
  };
  const c = (data && data.character) || {};
  add(c.original_name);
  add(c.name);
  (Array.isArray(data.characters) ? data.characters : []).forEach(add);
  if (!terms.length) return null;

  // 已知作品时直接在该作角色表里核对，名字对上才算，避免张冠李戴
  if (vn && vn.id) {
    const list = await vndbCharactersOfVn(vn.id);
    const hit = pickVnCharacter(list, terms);
    if (hit) return vndbHit(hit);
  }

  // 未知作品时按角色名反查，再绑定到所属作品
  for (const term of terms.slice(0, 2)) {
    const list = await vndbQuery('character', {
      filters: ['search', '=', term],
      fields: VNDB_CHAR_FIELDS,
      results: 8
    });
    const hit = pickCharacterFromSearch(list || [], terms, data, vn);
    if (hit) return vndbHit(hit);
  }
  return null;
}

function characterNameMatch(person, terms) {
  if (!person) return false;
  const names = [person.name, person.original]
    .concat(Array.isArray(person.aliases) ? person.aliases : [])
    .map((name) => normalizeName(name))
    .filter((name) => name && name.length >= 2);
  return terms.some((term) => {
    const target = normalizeName(term);
    if (!target) return false;
    return names.some((name) => name === target ||
      (name.length >= 3 && target.length >= 3 && (name.indexOf(target) !== -1 || target.indexOf(name) !== -1)));
  });
}

function pickVnCharacter(list, terms) {
  const matched = (list || []).filter((item) => characterNameMatch(item, terms));
  if (!matched.length) return null;
  return matched.find((item) => item.image && item.image.url && !Number(item.image.sexual)) ||
    matched.find((item) => item.image && item.image.url) || matched[0];
}

function pickCharacterFromSearch(list, terms, data, vn) {
  const matched = (list || []).filter((item) => characterNameMatch(item, terms));
  if (!matched.length) return null;
  const linksOf = (item) => (Array.isArray(item.vns) ? item.vns : []);
  const inVn = (item) => vn && linksOf(item).some((link) => link && link.id === vn.id);
  const work = normalizeTitle((data && (data.title_original || data.title_cn)) || '');
  const inWork = (item) => work && linksOf(item).some((link) => {
    const title = normalizeTitle(link && link.title);
    return title && (title.indexOf(work) !== -1 || work.indexOf(title) !== -1);
  });
  return matched.find((item) => inVn(item) && item.image && item.image.url) ||
    matched.find((item) => inWork(item) && item.image && item.image.url) ||
    matched.find((item) => item.image && item.image.url && !Number(item.image.sexual)) ||
    matched.find((item) => item.image && item.image.url) || matched[0];
}

function vndbHit(hit) {
  return {
    siteUrl: 'https://vndb.org/c' + hit.id,
    source: 'vndb',
    image: { large: (hit.image && hit.image.url) || '' },
    name: { full: hit.name || '', native: hit.original || '' },
    description: cleanVnText(hit.description)
  };
}

/* ---------------- VNDB：Galgame 精准识别 ---------------- */

const VNDB_API = 'https://api.vndb.org/kana';
const VNDB_SEARCH_FIELDS = 'id,title,alttitle,titles{lang,title,official,main},released,rating,votecount,image{url,sexual},developers{name}';
const VNDB_DETAIL_FIELDS = VNDB_SEARCH_FIELDS + ',length,description,tags{name,rating,spoiler,category},screenshots{url,sexual,violence}';
const VNDB_CHAR_FIELDS = 'id,name,original,aliases,image{url,sexual},description,vns{id,title,role}';

// VNDB 限速 200 次 / 5 分钟；同一会话内缓存，避免重复请求
const vndbCache = new Map();
const vnCharacterCache = new Map();

function vndbRemember(key, value) {
  vndbCache.set(key, value);
  if (vndbCache.size > 60) vndbCache.delete(vndbCache.keys().next().value);
}

async function vndbQuery(entity, payload) {
  const key = entity + '|' + JSON.stringify(payload);
  if (vndbCache.has(key)) return vndbCache.get(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(VNDB_API + '/' + entity, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json && json.results) ? json.results : [];
    vndbRemember(key, results);
    return results;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function vndbVnSearch(term, extraFilters, limit) {
  const filters = extraFilters
    ? ['and', ['search', '=', String(term)]].concat(extraFilters)
    : ['search', '=', String(term)];
  return vndbQuery('vn', { filters, fields: VNDB_SEARCH_FIELDS, results: limit || 4 });
}

function vndbVnBasic(id) {
  return vndbQuery('vn', { filters: ['id', '=', id], fields: VNDB_SEARCH_FIELDS, results: 1 })
    .then((list) => (list && list[0]) || null);
}

function vndbVnDetail(id) {
  return vndbQuery('vn', { filters: ['id', '=', id], fields: VNDB_DETAIL_FIELDS, results: 1 })
    .then((list) => (list && list[0]) || null);
}

async function vndbCharactersOfVn(vnId) {
  if (!vnId) return [];
  if (vnCharacterCache.has(vnId)) return vnCharacterCache.get(vnId);
  const list = (await vndbQuery('character', {
    filters: ['vn', '=', ['id', '=', vnId]],
    fields: VNDB_CHAR_FIELDS,
    results: 60
  })) || [];
  vnCharacterCache.set(vnId, list);
  return list;
}

/* ---------------- VNDB 候选打分 ---------------- */

const VN_GENERIC_TERM = /^(galgame|visual\s*novel|eroge|avg|视觉小说|恋爱冒险|游戏|截图|cg|anime|game|screenshot|插画)$/i;
const VN_LENGTH_ZH = { 1: '很短', 2: '较短', 3: '中等', 4: '较长', 5: '很长' };
const VN_TAG_ZH = {
  ADV: '文字冒险', NVL: '视觉小说', Romance: '恋爱', 'Pure Love Story': '纯爱',
  Comedy: '喜剧', Drama: '剧情', 'School Life': '校园生活', 'High School': '高中',
  Mystery: '悬疑', Horror: '恐怖', 'Slice of Life': '日常', Supernatural: '超自然',
  Magic: '魔法', 'Male Protagonist': '男主视角', 'Multiple Endings': '多结局',
  'Branching Plot': '分支剧情', 'Protagonist with a Face': '主角有立绘', 'Miko Heroine': '巫女女主',
  'Kemonomimi Heroine': '兽耳女主', 'Twin Tail Heroine': '双马尾女主',
  'Childhood Friend Heroine': '青梅竹马', 'Tsundere Heroine': '傲娇女主',
  'Imouto-type Heroine': '妹妹系女主', 'Oneesan-type Heroine': '姐姐系女主',
  'White Haired Heroine': '白发女主', 'Blonde Hair': '金发', Yandere: '病娇',
  Nakige: '泣系', Utsuge: '郁系', 'Modern Day Japan': '现代日本', Rural: '乡村',
  School: '校园', Military: '军事', Historical: '历史', 'Sword Combat': '剑戟',
  'Love Triangle': '三角恋', 'Harem Ending': '后宫结局'
};

function vnTagZh(name) {
  return GENRE_ZH[name] || VN_TAG_ZH[name] || String(name || '');
}

function vnTitleVariants(vn) {
  const list = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (text && list.indexOf(text) === -1) list.push(text);
  };
  push(vn.alttitle);
  push(vn.title);
  (Array.isArray(vn.titles) ? vn.titles : []).forEach((item) => {
    if (item && item.official !== false) push(item.title);
  });
  return list;
}

function vnPreferredTitle(vn) {
  const titles = Array.isArray(vn.titles) ? vn.titles : [];
  const zh = titles.find((t) => t && /^zh/i.test(t.lang) && t.main) ||
    titles.find((t) => t && /^zh/i.test(t.lang));
  if (zh && zh.title) return zh.title;
  return vnOriginalTitle(vn);
}

function vnOriginalTitle(vn) {
  const titles = Array.isArray(vn.titles) ? vn.titles : [];
  const ja = titles.find((t) => t && t.lang === 'ja' && t.main) ||
    titles.find((t) => t && t.lang === 'ja');
  return (ja && ja.title) || vn.alttitle || vn.title || '';
}

function vnRomanTitle(vn) {
  const base = vn.title || '';
  return normalizeTitle(base) && normalizeTitle(base) !== normalizeTitle(vnOriginalTitle(vn)) ? base : '';
}

function vnYear(vn) {
  const match = String((vn && vn.released) || '').match(/\d{4}/);
  return match ? match[0] : '';
}

function vnTopTags(vn) {
  return (Array.isArray(vn.tags) ? vn.tags : [])
    .filter((tag) => tag && tag.name && !Number(tag.spoiler) && tag.category === 'cont' && Number(tag.rating) >= 1.5)
    .sort((a, b) => Number(b.rating) - Number(a.rating))
    .slice(0, 6)
    .map((tag) => vnTagZh(tag.name));
}

function vnSignals(data) {
  const titles = [];
  const addTitle = (value) => {
    const text = String(value || '').trim();
    if (text.length < 2 || VN_GENERIC_TERM.test(text)) return;
    if (titles.some((item) => normalizeTitle(item) === normalizeTitle(text))) return;
    titles.push(text);
  };
  addTitle(data.title_original);
  addTitle(data.title_cn);
  addTitle(data.character && data.character.from);
  (Array.isArray(data.alternatives) ? data.alternatives : []).forEach((alt) => addTitle(alt && (alt.title || alt.name)));
  (Array.isArray(data.keywords) ? data.keywords : []).forEach(addTitle);

  const names = [];
  const addName = (value) => {
    const text = String(value || '').trim();
    if (text.length < 2) return;
    if (names.some((item) => normalizeTitle(item) === normalizeTitle(text))) return;
    names.push(text);
  };
  const character = (data && data.character) || {};
  addName(character.original_name);
  addName(character.name);
  (Array.isArray(data.characters) ? data.characters : []).forEach(addName);

  const brands = [];
  const addBrand = (value) => {
    const text = String(value || '').trim();
    if (text && text.length >= 2 && brands.indexOf(text) === -1) brands.push(text);
  };
  addBrand(data.brand);
  if (data.creator) String(data.creator).split(/[\/、,，;；|]+/).forEach(addBrand);

  const hint = (typeof readHint === 'function' ? readHint() : '') || '';
  const brandHint = hint.match(/(?:品牌|公司|开发商|制作|社团|brand|developer|studio)\s*[：:]\s*([^\n，,；;。]{1,40})/i);
  if (brandHint) addBrand(brandHint[1]);
  const year = (String(data.year || '').match(/(19|20)\d{2}/) || hint.match(/(19|20)\d{2}/) || [])[0] || '';

  return { titles, names, brands, year };
}

function scoreByTitles(vn, titles) {
  let best = 0;
  let reason = '';
  const variants = vnTitleVariants(vn);
  titles.forEach((title, index) => {
    const target = normalizeTitle(title);
    if (target.length < 2) return;
    const weight = index === 0 ? 1 : index === 1 ? 0.94 : 0.72;
    variants.forEach((variant) => {
      const value = normalizeTitle(variant);
      if (!value) return;
      if (value === target) {
        const score = 130 * weight;
        if (score > best) { best = score; reason = '标题完全一致'; }
      } else {
        const short = Math.min(value.length, target.length);
        const long = Math.max(value.length, target.length);
        if (short >= 3 && short / long >= 0.55 && (value.indexOf(target) !== -1 || target.indexOf(value) !== -1)) {
          const score = 70 * weight;
          if (score > best) { best = score; reason = '标题高度相似'; }
        }
      }
    });
  });
  return { score: best, reason };
}

function scoreByCharacter(characters, names) {
  if (!characters.length || !names.length) return { score: 0, reason: '', matched: null, strict: false };
  let best = 0;
  let matched = null;
  let strict = false;
  characters.forEach((item) => {
    const variants = [item.name, item.original].concat(Array.isArray(item.aliases) ? item.aliases : []);
    variants.forEach((name) => {
      const value = normalizeName(name);
      if (value.length < 2) return;
      names.forEach((term) => {
        const target = normalizeName(term);
        if (target.length < 2) return;
        const exact = value === target;
        const contains = value.length >= 3 && target.length >= 3 &&
          (value.indexOf(target) !== -1 || target.indexOf(value) !== -1);
        if (!exact && !contains) return;
        // 名字越具体越可信：只有姓氏（如「叢雨」）时降权，避免张冠李戴
        const specificity = target.length >= 4 ? 1 : target.length === 3 ? 0.72 : 0.5;
        const score = (exact ? 62 : 40) * specificity;
        if (score > best) {
          best = score;
          matched = item;
          strict = target.length >= 4;
        }
      });
    });
  });
  return { score: best, reason: best ? '角色一致' : '', matched, strict };
}

function scoreByBrand(vn, brands) {
  const developers = (Array.isArray(vn.developers) ? vn.developers : [])
    .map((item) => item && item.name).filter(Boolean);
  let best = 0;
  developers.forEach((name) => {
    const value = normalizeTitle(name);
    if (value.length < 3) return;
    brands.forEach((brand) => {
      const target = normalizeTitle(brand);
      if (target.length < 3) return;
      if (value === target) best = Math.max(best, 50);
      else if (value.indexOf(target) !== -1 || target.indexOf(value) !== -1) best = Math.max(best, 38);
    });
  });
  return { score: best, reason: best ? '品牌一致' : '' };
}

function scoreByYear(vn, year) {
  if (!year) return 0;
  const released = vnYear(vn);
  if (!released) return 0;
  if (released === year) return 22;
  return Math.abs(Number(released) - Number(year)) === 1 ? 10 : 0;
}

function popularityScore(vn) {
  const votes = Number(vn.votecount) || 0;
  const rating = Number(vn.rating) || 0;
  return Math.min(24, Math.log10(1 + votes) * 7) + Math.min(10, Math.max(0, (rating - 60) / 2));
}

// 多路召回 + 打分：标题 / 角色 / 品牌 / 年份 / 口碑，角色出现在候选作品里即二次确认
async function findVnMatch(data) {
  const sig = vnSignals(data);
  if (!sig.titles.length && !sig.names.length && !sig.brands.length) return null;

  const pool = new Map();
  const put = (vn, bonus, reason) => {
    if (!vn || !vn.id) return;
    let entry = pool.get(vn.id);
    if (!entry) {
      entry = { vn: { id: vn.id }, bonus: 0, reasons: [] };
      pool.set(vn.id, entry);
    }
    if (vn.title && !entry.vn.title) entry.vn.title = vn.title;
    entry.bonus = Math.max(entry.bonus, bonus || 0);
    if (reason && entry.reasons.indexOf(reason) === -1) entry.reasons.push(reason);
  };

  const titleTerms = sig.titles.slice(0, 4);
  const titleLists = await Promise.all(titleTerms.map((term) => vndbVnSearch(term, null, 4)));
  titleLists.forEach((list) => (list || []).forEach((vn) => put(vn, 0, '标题检索')));

  const charTerms = sig.names.slice(0, 2);
  const charLists = await Promise.all(charTerms.map((term) => vndbQuery('character', {
    filters: ['search', '=', term],
    fields: 'id,name,original,aliases,vns{id,title,role}',
    results: 6
  })));
  charLists.forEach((list) => (list || []).forEach((item) => {
    if (!characterNameMatch(item, sig.names)) return;
    (Array.isArray(item.vns) ? item.vns : []).forEach((link) => {
      const role = String((link && link.role) || '');
      // 只作为「进入校验队列」的加权，真正的加分在角色表核对时给出
      put(link, /primary|main/i.test(role) ? 46 : 34, '角色所属作品');
    });
  }));

  if (sig.brands.length) {
    const list = await vndbVnSearch(sig.brands[0], null, 6);
    (list || []).forEach((vn) => put(vn, 0, '品牌候选'));
  }

  const entries = Array.from(pool.values());
  if (!entries.length) return { best: null, others: [] };

  // 角色反查得到的条目只有 id，补齐标题 / 封面等基础信息（最多 8 个，避免拖慢）
  const needBasic = entries
    .filter((entry) => !entry.vn.titles && !entry.vn.alttitle)
    .sort((a, b) => b.bonus - a.bonus)
    .slice(0, 8);
  await Promise.all(needBasic.map(async (entry) => {
    const basic = await vndbVnBasic(entry.vn.id);
    if (basic) entry.vn = basic;
  }));

  entries.forEach((entry) => {
    const titleHit = scoreByTitles(entry.vn, sig.titles);
    const brandHit = scoreByBrand(entry.vn, sig.brands);
    entry.titleScore = titleHit.score;
    entry.brandScore = brandHit.score;
    entry.score = entry.bonus + titleHit.score + brandHit.score +
      scoreByYear(entry.vn, sig.year) + popularityScore(entry.vn);
    if (titleHit.reason) entry.reasons.push(titleHit.reason);
    if (brandHit.reason) entry.reasons.push(brandHit.reason);
  });
  entries.sort((a, b) => b.score - a.score);

  await Promise.all(entries.slice(0, 3).map(async (entry) => {
    const characters = await vndbCharactersOfVn(entry.vn.id);
    const hit = scoreByCharacter(characters, sig.names);
    if (hit.score) {
      entry.score += hit.score;
      if (entry.reasons.indexOf(hit.reason) === -1) entry.reasons.push(hit.reason);
      entry.character = hit.matched;
      entry.charStrict = hit.strict;
    }
  }));
  entries.sort((a, b) => b.score - a.score);
  entries.forEach((entry) => {
    entry.reasons = entry.reasons.filter((item, index, arr) => arr.indexOf(item) === index);
  });

  // 只有品牌或只有模糊角色名时不算确认，避免把同品牌的其他作品当成答案
  const top = entries[0];
  const corroborated = top && (top.titleScore > 0 || top.charStrict);
  const best = top && top.score >= 65 && corroborated ? top : null;
  const others = entries
    .filter((entry) => entry !== best && entry.score >= 60)
    .slice(0, 4);

  if (best) {
    const detail = await vndbVnDetail(best.vn.id);
    if (detail) best.vn = detail;
  }
  return { best, others, signals: sig };
}

function vnMatchLabel(score) {
  if (score >= 170) return '高度确信';
  if (score >= 115) return '较可信';
  return '参考匹配';
}

function renderVnResult(match) {
  const el = $('vndbBlock');
  if (!el) return;
  const best = match && match.best;
  const others = (match && match.others) || [];
  if (!best && !others.length) {
    el.innerHTML = '';
    return;
  }

  let html = '';
  if (best) {
    const vn = best.vn || {};
    const title = vnPreferredTitle(vn) || vn.title || '未知作品';
    const original = vnOriginalTitle(vn);
    const roman = vnRomanTitle(vn);
    const year = vnYear(vn);
    const developers = (vn.developers || []).map((d) => d && d.name).filter(Boolean).join(' / ');
    const meta = [year, developers].filter(Boolean).map(esc).join(' · ');
    const stats = [];
    if (vn.rating) stats.push('★ ' + (Number(vn.rating) / 10).toFixed(1) + ' VNDB');
    if (vn.votecount) stats.push(Number(vn.votecount).toLocaleString('zh-CN') + ' 人评价');
    if (vn.length && VN_LENGTH_ZH[vn.length]) stats.push('流程' + VN_LENGTH_ZH[vn.length]);
    const tags = vnTopTags(vn);
    const reasons = (best.reasons || []).slice(0, 4);
    const shots = (Array.isArray(vn.screenshots) ? vn.screenshots : [])
      .filter((shot) => shot && shot.url && Number(shot.sexual) < 0.5 && !Number(shot.violence))
      .slice(0, 4);
    const desc = cleanVnText(vn.description, 360);

    html += '<div class="block"><h3>VNDB 作品档案</h3><div class="vn-card">';
    html += (vn.image && vn.image.url
      ? '<img class="vn-cover" src="' + esc(vn.image.url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
      : '<span class="vn-cover vn-cover-none"></span>');
    html += '<div class="vn-info">';
    html += '<span class="vn-badge">VNDB · ' + esc(vnMatchLabel(best.score)) + '</span>';
    html += '<h3 class="vn-title">' + esc(title) + '</h3>';
    if (normalizeTitle(original) && normalizeTitle(original) !== normalizeTitle(title)) {
      html += '<p class="vn-roman">' + esc(original) + (roman ? ' · ' + esc(roman) : '') + '</p>';
    } else if (roman) {
      html += '<p class="vn-roman">' + esc(roman) + '</p>';
    }
    if (meta) html += '<p class="vn-meta">' + meta + '</p>';
    if (stats.length) html += '<p class="vn-meta">' + esc(stats.join(' · ')) + '</p>';
    if (desc) html += '<p class="vn-desc">' + esc(desc) + '</p>';
    if (tags.length) {
      html += '<div class="chip-row">' + tags.map((tag) => '<span class="chip">' + esc(tag) + '</span>').join('') + '</div>';
    }
    if (reasons.length) {
      html += '<p class="vn-reason">匹配依据：' + esc(reasons.join(' · ')) +
        (best.character ? '（模型给出的角色确实属于此作）' : '') + '</p>';
    }
    if (vn.id) {
      html += '<a class="media-link" href="https://vndb.org/' + esc(vn.id) + '" target="_blank" rel="noopener">在 VNDB 查看 →</a>';
    }
    if (shots.length) {
      html += '<div class="vn-shots">' + shots.map((shot) =>
        '<a class="vn-shot" href="https://vndb.org/' + esc(vn.id) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(shot.url) + '" alt="VNDB 官方截图" loading="lazy" referrerpolicy="no-referrer" /></a>'
      ).join('') + '</div>' +
        '<p class="vn-shot-note">VNDB 收录的官方截图，可直接与你的画面比对确认。</p>';
    }
    html += '</div></div></div>';
  }

  if (others.length) {
    html += '<div class="block"><h3>其他 VNDB 候选</h3><div class="candidates">' + others.map((item) => {
      const vn = item.vn || {};
      const name = vnPreferredTitle(vn) || vn.title || '未知作品';
      const original = vnOriginalTitle(vn);
      return '<a class="cand" href="https://vndb.org/' + esc(vn.id) + '" target="_blank" rel="noopener">' +
        (vn.image && vn.image.url
          ? '<img src="' + esc(vn.image.url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
          : '<span class="cand-none"></span>') +
        '<span><strong>' + esc(name) + '</strong>' +
        (normalizeTitle(original) && normalizeTitle(original) !== normalizeTitle(name)
          ? '<em>' + esc(original) + '</em>' : '') +
        '<em>' + esc([vnYear(vn), '匹配度 ' + Math.round(Math.min(100, item.score / 2.4))].filter(Boolean).join(' · ')) + '</em>' +
        '</span></a>';
    }).join('') + '</div>' +
      '<p class="online-note">按标题、角色、品牌、年份与口碑综合排序；前面没确认时，点开封面人工核对最快。</p></div>';
  }

  el.innerHTML = html;

  if (best && best.vn) {
    const desc = cleanVnText(best.vn.description, 360);
    if (desc && needsZh(desc)) {
      translateToZh(desc).then((zh) => {
        if (!zh || zh === desc) return;
        const node = el.querySelector('.vn-desc');
        if (node) node.textContent = zh;
      });
    }
  }
}

function cleanVnText(text, limit) {
  return String(text || '')
    .replace(/\[\/?(?:url|i|b|u|spoiler|quote)(?:=[^\]]*)?\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit || 180);
}

async function findSteamGame(data) {
  if (!isGameType(data && data.type)) return null;
  const term = data.title_original || data.title_cn;
  if (!term) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch('https://store.steampowered.com/api/storesearch/?term=' +
      encodeURIComponent(term) + '&l=schinese&cc=CN', { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const item = json && Array.isArray(json.items) ? json.items[0] : null;
    if (!item || !item.tiny_image) return null;
    return {
      title: item.name || term,
      cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + encodeURIComponent(item.id) + '/header.jpg',
      href: 'https://store.steampowered.com/app/' + encodeURIComponent(item.id) + '/'
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function modelResultToText(data, model) {
  const lines = [];
  lines.push('【AniLens 识别结果】' + (model ? '（模型：' + model + '）' : ''));
  lines.push('作品：' + (data.title_cn || '未知') + (data.title_original ? ' / ' + data.title_original : ''));
  if (data.type) lines.push('类型：' + data.type);
  if (data.year) lines.push('年份：' + data.year);
  if (data.creator) lines.push('制作/开发：' + data.creator);
  if (data.synopsis) lines.push('简介：' + data.synopsis);
  if (Array.isArray(data.characters) && data.characters.length) lines.push('角色：' + data.characters.join('、'));
  const conf = normalizeConfidence(data.confidence);
  if (conf !== null) lines.push('置信度：' + conf + '%');
  if (data.scene) lines.push('场景：' + data.scene);
  if (data.evidence) lines.push('依据：' + data.evidence);
  if (Array.isArray(data.keywords) && data.keywords.length) lines.push('关键词：' + data.keywords.join('、'));
  if (data.character && (data.character.name || data.character.original_name)) {
    const c = data.character;
    lines.push('图中人物：' + [c.name || c.original_name, c.from, c.role].filter(Boolean).join(' · '));
  }
  if (Array.isArray(data.similar_characters) && data.similar_characters.length) {
    lines.push('相似角色：' + data.similar_characters
      .map((c) => (c && (c.name || c.original_name) ? (c.name || c.original_name) + (c.from ? '（' + c.from + '）' : '') : ''))
      .filter(Boolean).join('、'));
  }
  if (data.note) lines.push('备注：' + data.note);
  if (Array.isArray(data.alternatives) && data.alternatives.length) {
    lines.push('其他可能：' + data.alternatives.map((a) => (a && (a.title || a.name)) || '').filter(Boolean).join('、'));
  }
  return lines.join('\n');
}

/* ---------------- 联网增强（AniList） ---------------- */

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

const MEDIA_QUERY = `query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type) {
    id
    siteUrl
    title { romaji english native }
    coverImage { large }
    averageScore
    format
    seasonYear
    episodes
    status
    genres
    description(asHtml: false)
    recommendations(perPage: 6) {
      nodes {
        mediaRecommendation {
          id
          siteUrl
          type
          averageScore
          title { native romaji english }
          coverImage { large }
        }
      }
    }
  }
}`;

const CHARACTER_QUERY = `query ($search: String) {
  Page(perPage: 1) {
    characters(search: $search) {
      id
      siteUrl
      name { full native }
      image { large }
      media(perPage: 1) {
        nodes { id siteUrl title { native romaji english } }
      }
    }
  }
}`;

async function anilistRequest(query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('AniList HTTP ' + res.status);
    const json = await res.json();
    if (json && json.errors && json.errors.length) throw new Error(json.errors[0].message || 'AniList 查询错误');
    return { data: json.data || null, serverDate: res.headers.get('date') };
  } finally {
    clearTimeout(timer);
  }
}

const anilistCache = new Map();

async function anilistQuery(query, variables) {
  const key = String(query).slice(0, 48) + '|' + JSON.stringify(variables || {});
  if (anilistCache.has(key)) return anilistCache.get(key);
  const result = await anilistRequest(query, variables);
  anilistCache.set(key, result.data);
  if (anilistCache.size > 80) anilistCache.delete(anilistCache.keys().next().value);
  return result.data;
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

// 联网数据多为英文/日文，展示前自动翻译成中文
const translateCache = new Map();

function needsZh(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk / raw.length < 0.2;
}

async function translateRaw(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const snippet = raw.slice(0, 450);
  if (translateCache.has(snippet)) return translateCache.get(snippet);
  const source = /[\u3040-\u30ff]/.test(snippet) ? 'ja' : 'en';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(snippet) + '&langpair=' + source + '%7Czh-CN',
      { signal: controller.signal }
    );
    if (!res.ok) return '';
    const json = await res.json();
    const zh = json && json.responseData && json.responseData.translatedText;
    if (!zh || /NO QUERY SPECIFIED|INVALID|MYMEMORY WARNING/i.test(zh)) return '';
    const out = raw.length > 450 ? zh + '…' : zh;
    translateCache.set(snippet, out);
    return out;
  } catch (err) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function translateToZh(text) {
  const raw = String(text || '').trim();
  if (!raw || !needsZh(raw)) return raw;
  return (await translateRaw(raw)) || raw;
}

const FORMAT_ZH = { TV: 'TV 动画', TV_SHORT: 'TV 短片', MOVIE: '剧场版', SPECIAL: '特别篇', OVA: 'OVA', ONA: '网络动画', MUSIC: '音乐', MANGA: '漫画', NOVEL: '小说', ONE_SHOT: '单话' };
const STATUS_ZH = { FINISHED: '已完结', RELEASING: '连载中', NOT_YET_RELEASED: '未播出', CANCELLED: '已取消', HIATUS: '休载' };
const GENRE_ZH = {
  Action: '动作', Adventure: '冒险', Comedy: '喜剧', Drama: '剧情', Fantasy: '奇幻', Horror: '恐怖',
  'Mahou Shoujo': '魔法少女', Mecha: '机甲', Music: '音乐', Mystery: '悬疑', Psychological: '心理',
  Romance: '恋爱', 'Sci-Fi': '科幻', 'Slice of Life': '日常', Sports: '运动', Supernatural: '超自然',
  Thriller: '惊悚', Ecchi: '擦边', Hentai: '成人', 'Video Game': '游戏改', Historical: '历史',
  School: '校园', Military: '军事', Demons: '妖魔', Space: '太空', Isekai: '异世界', Josei: '女性向',
  Seinen: '青年向', Shounen: '少年向', Shoujo: '少女向', Parody: '恶搞', Samurai: '武士', Gourmet: '美食',
  RPG: '角色扮演', Strategy: '策略', Simulation: '模拟', Casual: '休闲', Indie: '独立', Racing: '竞速',
  MMORPG: '大型多人在线 RPG', Shooter: '射击', MOBA: '多人在线竞技', 'Card Game': '卡牌', Card: '卡牌',
  'Battle Royale': '大逃杀', 'Action RPG': '动作 RPG', Sandbox: '沙盒', 'Open World': '开放世界',
  Survival: '生存', PvP: '玩家对战', PvE: '玩家对环境', Voxel: '体素', Pixel: '像素', Zombies: '丧尸',
  'Turn-Based': '回合制', Education: '教育', Fighting: '格斗', Social: '社交',
  'Massively Multiplayer': '大型多人在线', 'Early Access': '抢先体验', 'Free to Play': '免费游玩',
  'Sexual Content': '成人内容', Gore: '血腥', Nudity: '裸露', 'Violent': '暴力'
};

function zhGenre(value) {
  const raw = String(value || '');
  return GENRE_ZH[raw] || raw;
}

function pickMediaTitle(title) {
  if (!title) return '未知作品';
  return title.native || title.romaji || title.english || '未知作品';
}

function onlineSkeletonHtml() {
  return '<div class="skeleton"></div><p class="online-note" style="margin-top:10px">正在联网检索作品资料与相似角色…</p>';
}

function modelSimilarCharacters(data) {
  return (Array.isArray(data.similar_characters) ? data.similar_characters : [])
    .filter((c) => c && (c.name || c.original_name))
    .slice(0, 3)
    .map((c) => ({
      name: c.name || c.original_name,
      original: c.original_name || c.name,
      from: c.from || '',
      reason: c.reason || '',
      image: '',
      href: ''
    }));
}

async function findAnilistMedia(data) {
  const raw = [data.title_original, data.title_cn]
    .concat(Array.isArray(data.keywords) ? data.keywords : []);
  const titles = [...new Set(raw.filter(Boolean).map((t) => String(t).trim()).filter(Boolean))].slice(0, 3);
  const type = /漫画|manga/i.test(data.type || '') ? 'MANGA' : 'ANIME';
  for (const search of titles) {
    try {
      const res = await anilistQuery(MEDIA_QUERY, { search, type });
      if (res && res.Media) return res.Media;
    } catch (err) {
      /* 尝试下一个候选标题 */
    }
  }
  return null;
}

async function searchAnilistCharacter(term) {
  if (!term) return null;
  try {
    const res = await anilistQuery(CHARACTER_QUERY, { search: term });
    return (res && res.Page && res.Page.characters && res.Page.characters[0]) || null;
  } catch (err) {
    return null;
  }
}

async function findMainCharacter(data) {
  const c = data && data.character;
  if (!c || !(c.original_name || c.name)) return null;
  return searchAnilistCharacter(c.original_name || c.name);
}

async function findSimilarCharacters(data) {
  const list = modelSimilarCharacters(data);
  return Promise.all(list.map(async (item) => {
    if (!item.original) return item;
    const hit = await searchAnilistCharacter(item.original);
    if (!hit) return item;
    const media = hit.media && hit.media.nodes && hit.media.nodes[0];
    return {
      name: (hit.name && (hit.name.native || hit.name.full)) || item.name,
      original: item.original,
      from: item.from || (media ? pickMediaTitle(media.title) : ''),
      reason: item.reason,
      image: (hit.image && hit.image.large) || '',
      href: hit.siteUrl || (media && media.siteUrl) || ''
    };
  }));
}

function simCardHtml(item) {
  const avatar = item.image
    ? '<img src="' + esc(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '<span class="sim-initial">' + esc((item.name || '?').slice(0, 1)) + '</span>';
  const inner = '<div class="sim-avatar">' + avatar + '</div>' +
    '<div class="sim-body"><strong>' + esc(item.name || '未知角色') + '</strong>' +
    (item.from ? '<span class="sim-from">' + esc(item.from) + '</span>' : '') +
    (item.reason ? '<p>' + esc(item.reason) + '</p>' : '') + '</div>';
  return item.href
    ? '<a class="sim-card" href="' + esc(item.href) + '" target="_blank" rel="noopener">' + inner + '</a>'
    : '<div class="sim-card">' + inner + '</div>';
}

function recCardHtml(media) {
  const cover = media.coverImage && media.coverImage.large
    ? '<img src="' + esc(media.coverImage.large) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '<div class="rec-cover-fallback"></div>';
  return '<a class="rec-card" href="' + esc(media.siteUrl || '#') + '" target="_blank" rel="noopener">' +
    cover + '<strong>' + esc(pickMediaTitle(media.title)) + '</strong>' +
    '<span>' + (media.averageScore ? '★ ' + (media.averageScore / 10).toFixed(1) : '') + '</span></a>';
}

function renderSimilarOnly(list) {
  const block = $('onlineBlock');
  if (!block) return;
  if (!list.length) {
    block.innerHTML = '<p class="online-note">联网增强已关闭。开启后可按角色特征检索相似角色，并补充作品资料。</p>';
    return;
  }
  block.innerHTML = '<div class="online-head">相似角色推荐 · 模型判断（联网增强已关闭）</div>' +
    '<div class="sim-grid">' + list.map(simCardHtml).join('') + '</div>';
}

function renderOnlineBlock(media, similar, hasSynopsis, hasVn) {
  const block = $('onlineBlock');
  if (!block) return;
  if (!media && !similar.length) {
    block.innerHTML = '';
    return;
  }
  let html = '<div class="online-head"><span class="online-dot"></span>' +
    (media ? '联网增强 · 数据来自 AniList' : '相似角色推荐') + '</div>';

  if (media) {
    const title = pickMediaTitle(media.title);
    const desc = stripHtml(media.description);
    const sub = [FORMAT_ZH[media.format] || media.format, media.seasonYear, media.episodes ? media.episodes + ' 集' : '', STATUS_ZH[media.status] || media.status]
      .filter(Boolean).join(' · ');
    const genres = Array.isArray(media.genres) ? media.genres.slice(0, 5) : [];
    html += '<div class="media-card">' +
      (media.coverImage && media.coverImage.large
        ? '<img class="media-cover" src="' + esc(media.coverImage.large) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
        : '') +
      '<div class="media-info"><h3>' + esc(title) + '</h3>' +
      (sub ? '<p class="media-sub">' + esc(sub) + '</p>' : '') +
      (media.averageScore ? '<p class="media-score">★ ' + (media.averageScore / 10).toFixed(1) + '<span>AniList 均分</span></p>' : '') +
      (desc && !hasSynopsis ? '<p class="media-desc">' + esc(desc.slice(0, 220)) + (desc.length > 220 ? '…' : '') + '</p>' : '') +
      (genres.length ? '<div class="chip-row">' + genres.map((g) => '<span class="chip">' + esc(zhGenre(g)) + '</span>').join('') + '</div>' : '') +
      (media.siteUrl ? '<a class="media-link" href="' + esc(media.siteUrl) + '" target="_blank" rel="noopener">在 AniList 查看 →</a>' : '') +
      '</div></div>';
  } else if (!hasVn) {
    html += '<p class="online-note">未检索到对应条目，可能该作品不是动画或漫画，或联网请求暂时失败。</p>';
  }

  if (similar.length) {
    html += '<div class="block"><h3>相似角色推荐</h3><div class="sim-grid">' +
      similar.map(simCardHtml).join('') + '</div></div>';
  }

  if (media && Array.isArray(media.recommendations && media.recommendations.nodes)) {
    const recs = media.recommendations.nodes.map((node) => node && node.mediaRecommendation).filter(Boolean).slice(0, 6);
    if (recs.length) {
      html += '<div class="block"><h3>相似作品推荐</h3><div class="rec-grid">' +
        recs.map(recCardHtml).join('') + '</div></div>';
    }
  }

  block.innerHTML = html;
  if (media && !hasSynopsis) {
    const mediaDesc = stripHtml(media.description);
    if (mediaDesc && needsZh(mediaDesc)) {
      translateToZh(mediaDesc.slice(0, 220)).then((zh) => {
        if (!zh || zh === mediaDesc) return;
        const node = block.querySelector('.media-desc');
        if (node) node.textContent = zh;
      });
    }
  }
}

async function enhanceOnline(data) {
  const block = $('onlineBlock');
  if (!block) return;
  const token = state.reqToken;

  if (!currentConfig().online) {
    renderSimilarOnly(modelSimilarCharacters(data));
    return;
  }

  block.innerHTML = onlineSkeletonHtml();

  const type = String((data && data.type) || '');
  const isVn = /galgame|视觉小说|avg|eroge|恋爱冒险/i.test(type);
  const isAnime = /番剧|剧场版|动画|tv|ova|ona|漫画|manga/i.test(type);
  const isGame = isGameType(type);
  const character = (data && data.character) || {};
  const charTerm = character.original_name || character.name || '';

  // 番剧类可以并行查 AniList 角色；Galgame 先查 VNDB，避免无谓请求
  const anilistCharacterPromise = (!isVn && charTerm)
    ? findMainCharacter(data).catch(() => null)
    : null;
  const similarPromise = (charTerm || modelSimilarCharacters(data).length)
    ? findSimilarCharacters(data).catch(() => modelSimilarCharacters(data))
    : Promise.resolve([]);

  let media = null;
  let steam = null;
  let vn = null;
  let vnMatch = null;

  if (isVn) {
    // Galgame 直接走 VNDB 多路召回，命中即作品 + 角色双重确认
    vnMatch = await findVnMatch(data);
    if (token !== state.reqToken) return;
  } else {
    // 智能排序：先查最可能命中的库，拿到确切标题后立即停止后续检索
    const order = isAnime ? ['anilist'] : isGame ? ['steam'] : ['anilist', 'steam'];
    for (const source of order) {
      if (source === 'anilist') {
        media = await findAnilistMedia(data);
        if (token !== state.reqToken) return;
        if (media && exactTitleMatch(data, anilistTitles(media))) break;
      } else if (source === 'steam') {
        steam = steam || await findSteamGame(data);
        if (token !== state.reqToken) return;
        if (steam && exactTitleMatch(data, [steam.title])) break;
      }
    }
    const lowConfidence = confidenceOf(data) < 0.7 || data.found === false;
    if ((isGame || (lowConfidence && !media)) &&
      !(steam && exactTitleMatch(data, [steam.title]))) {
      vnMatch = await findVnMatch(data);
      if (token !== state.reqToken) return;
    }
  }
  if (vnMatch && vnMatch.best) vn = vnMatch.best.vn;

  let characterHit = vnMatch && vnMatch.best && vnMatch.best.character
    ? vndbHit(vnMatch.best.character)
    : null;
  if (!characterHit && charTerm) {
    if (isVn) {
      characterHit = await findVnCharacter(data, vn);
    } else {
      const anilistHit = anilistCharacterPromise
        ? await anilistCharacterPromise
        : await findMainCharacter(data).catch(() => null);
      if (anilistHit && characterMatches(charTerm, anilistHit)) characterHit = anilistHit;
      if (!characterHit) characterHit = await findVnCharacter(data, vn);
    }
  }
  if (token !== state.reqToken) return;
  renderCharacterBlock(data, characterHit);

  const similar = (await similarPromise) || modelSimilarCharacters(data);
  if (token !== state.reqToken) return;

  renderSynopsis(data, steam);

  if (vnMatch && (vnMatch.best || (vnMatch.others && vnMatch.others.length))) {
    renderVnResult(vnMatch);
  } else {
    const vnBlock = $('vndbBlock');
    if (vnBlock) vnBlock.innerHTML = '';
  }

  if (!media && !steam && !vn && !similar.length) {
    block.innerHTML = '<p class="online-note">联网查询暂不可用，或该作品不在 AniList、Steam、VNDB 数据库中。</p>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-action="online-retry">重试联网查询</button>';
    return;
  }
  renderOnlineBlock(media, similar, !!data.synopsis, !!vn);
}

function exactTitleMatch(data, candidates) {
  const targets = [data.title_cn, data.title_original].map(normalizeTitle).filter(Boolean);
  if (!targets.length) return false;
  return candidates.filter(Boolean).some((candidate) => {
    const value = normalizeTitle(candidate);
    return Boolean(value) && targets.indexOf(value) !== -1;
  });
}

function anilistTitles(media) {
  const title = media && media.title;
  return title ? [title.native, title.romaji, title.english].filter(Boolean) : [];
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-z\u3040-\u30ff\u4e00-\u9fff]/g, '');
}

// 角色名匹配：片假名转平假名，避免「ムラサメ」与「むらさめ」对不上
function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[^0-9a-z\u3040-\u30ff\u4e00-\u9fff]/g, '');
}

// AniList 角色搜索是模糊匹配，名字对不上就不要用，避免张冠李戴
function characterMatches(term, hit) {
  const target = normalizeTitle(term);
  if (!target) return true;
  const names = [hit && hit.name && hit.name.full, hit && hit.name && hit.name.native].filter(Boolean);
  return names.some((name) => {
    const value = normalizeTitle(name);
    return Boolean(value) && (value.indexOf(target) !== -1 || target.indexOf(value) !== -1);
  });
}

function showError(title, message, retryAction) {
  $('resultSource').textContent = '识别失败';
  $('resultSource').className = 'badge badge-warn';
  const retry = retryAction
    ? '<div class="block"><button class="btn btn-sm btn-ghost" type="button" data-action="' + esc(retryAction) + '">重试</button></div>'
    : '';
  $('resultBody').innerHTML = '<div class="error-box"><b>' + esc(title) + '</b><br>' + esc(message) + '</div>' + retry;
  showResults();
}

function showResults() {
  $('resultsPanel').hidden = false;
  $('resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------------- 免费溯源：trace.moe 交叉认证 ---------------- */

const TRACE_CACHE_KEY = 'anilens.tracecache.v2';
const TRACE_TTL = 12 * 60 * 60 * 1000;
/* 相似度为 0–100。低于门槛通常是无关图片的“假命中”，必须丢弃 */
const TRACE_MIN_SIM = 75;
const TRACE_GOOD_SIM = 87;
const TRACE_SURE_SIM = 93;
const TRACE_TIMEOUT_MS = 20000;

function formatTime(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl).split(',');
  const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const binary = atob(parts[1] || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* 纯色/极低信息量图片会让 trace.moe 返回 99% 的假命中，先做本地检测 */
function imageInformativeness(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = 64;
        const h = Math.max(1, Math.round((img.height / img.width) * w)) || w;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const lum = new Float32Array(w * h);
        let sum = 0;
        let sum2 = 0;
        for (let i = 0; i < w * h; i += 1) {
          const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
          lum[i] = l;
          sum += l;
          sum2 += l * l;
        }
        const mean = sum / (w * h);
        const variance = Math.max(0, sum2 / (w * h) - mean * mean);
        let edge = 0;
        for (let y = 0; y < h; y += 1) {
          for (let x = 1; x < w; x += 1) edge += Math.abs(lum[y * w + x] - lum[y * w + x - 1]);
        }
        resolve({ variance, edge: edge / (h * (w - 1)) });
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/* 供兜底区块下载当前图片，便于在 ascii2d / Yandex 站内手动上传 */
function downloadImage() {
  if (!state.dataUrl) return;
  const a = document.createElement('a');
  a.href = state.dataUrl;
  a.download = 'anilens-scene.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function hashImage(dataUrl) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(dataUrl.length / 4096));
  for (let i = 0; i < dataUrl.length; i += step) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + '_' + dataUrl.length;
}

function readTraceCache(key) {
  try {
    const map = JSON.parse(localStorage.getItem(TRACE_CACHE_KEY) || '{}') || {};
    const hit = map[key];
    if (hit && Date.now() - hit.ts < TRACE_TTL && Array.isArray(hit.items) && hit.items.length) {
      return hit.items;
    }
  } catch (e) {}
  return null;
}

function writeTraceCache(key, items) {
  try {
    const map = JSON.parse(localStorage.getItem(TRACE_CACHE_KEY) || '{}') || {};
    map[key] = { ts: Date.now(), items };
    const trimmed = {};
    Object.keys(map)
      .sort((a, b) => map[b].ts - map[a].ts)
      .slice(0, 10)
      .forEach((k) => { trimmed[k] = map[k]; });
    localStorage.setItem(TRACE_CACHE_KEY, JSON.stringify(trimmed));
  } catch (e) {}
}

function traceRequest(blob, cutBorders) {
  const url = 'https://api.trace.moe/search?anilistInfo' + (cutBorders ? '&cutBorders' : '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

function traceItems(data) {
  return ((data && data.result) || []).map((r) => {
    const title = (r.anilist && r.anilist.title) || {};
    const primary = title.chinese || title.native || title.romaji || title.english || r.filename || '未知作品';
    const altParts = [title.chinese, title.native, title.romaji, title.english]
      .filter(Boolean)
      .filter((t) => t !== primary);
    return {
      title: primary,
      alt: altParts.slice(0, 2).join(' / '),
      similarity: Math.round((r.similarity || 0) * 100),
      episode: r.episode != null ? r.episode : '',
      at: formatTime(r.from),
      to: formatTime(r.to),
      episodes: r.anilist && r.anilist.episodes ? r.anilist.episodes : '',
      image: r.image || '',
      video: r.video || '',
      anilistId: r.anilist && r.anilist.id ? r.anilist.id : '',
      isAdult: Boolean(r.anilist && r.anilist.isAdult)
    };
  }).sort((a, b) => b.similarity - a.similarity);
}

/* 按可信度与内容安全过滤；同一作品同一集只保留最高相似度的一条 */
function tracePick(items) {
  const seen = new Set();
  const out = [];
  (items || []).forEach((it) => {
    if (it.isAdult) return;
    if (it.similarity < TRACE_MIN_SIM) return;
    const key = (it.anilistId || it.title) + '|' + (it.episode === '' ? 'mov' : it.episode);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  });
  return out.slice(0, 6);
}

function traceQuota(data) {
  if (!data) return null;
  const limit = Number(data.quota);
  const used = Number(data.quotaUsed);
  if (!limit || isNaN(used)) return null;
  return { limit, used };
}

function traceAligned(item, modelTitle) {
  const target = normalizeTitle(modelTitle);
  if (!target) return false;
  const pool = normalizeTitle((item.title || '') + (item.alt || ''));
  const own = normalizeTitle(item.title);
  return pool.indexOf(target) !== -1 || (own && target.indexOf(own) !== -1);
}

async function runTrace(blob, cacheKey) {
  const cachedRaw = readTraceCache(cacheKey);
  if (cachedRaw) {
    const picked = tracePick(cachedRaw);
    if (picked.length) {
      return { ok: true, items: picked, cached: true, rejected: Math.max(0, cachedRaw.length - picked.length) };
    }
  }
  let res;
  try {
    res = await traceRequest(blob, true);
  } catch (err) {
    return { ok: false, title: '免费溯源超时', error: 'trace.moe 响应过慢或暂时不可达，请稍后重试。' };
  }
  if (res.status === 429) {
    return { ok: false, title: '免费额度暂时用完', error: 'trace.moe 每个网络每天有免费次数限制，请稍后再试。' };
  }
  if (!res.ok) {
    return { ok: false, title: '免费溯源失败', error: 'trace.moe 返回 HTTP ' + res.status + '。' };
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, title: '免费溯源失败', error: 'trace.moe 返回内容无法解析。' };
  }
  if (data && data.error) {
    return { ok: false, title: '免费溯源失败', error: String(data.error) };
  }
  const all = traceItems(data);
  let items = tracePick(all);
  let rejected = Math.max(0, all.length - items.length);
  let fallback = false;
  const best = items.length ? items[0].similarity : 0;
  /* 裁边模式没有可靠命中时，改用整图再试一次 */
  if (!items.length || best < TRACE_GOOD_SIM) {
    try {
      const retry = await traceRequest(blob, false);
      if (retry.ok) {
        const retryData = await retry.json();
        if (retryData && !retryData.error) {
          const retryItems = tracePick(traceItems(retryData));
          if (retryItems.length && (!items.length || retryItems[0].similarity > best)) {
            items = retryItems;
            fallback = true;
            rejected = 0;
          }
        }
      }
    } catch (e) {}
  }
  if (items.length) writeTraceCache(cacheKey, items);
  return { ok: true, items, rejected, fallback, quota: traceQuota(data) };
}

function crossCheck(trace, modelTitle) {
  const best = trace[0];
  const signals = [];
  if (!best) {
    return {
      level: 'none', label: '未命中', signals,
      text: 'trace.moe 没有返回可靠结果。游戏、漫画、剧场版或经过裁切的截图，建议用「用我的模型识别」。'
    };
  }

  const targetKey = best.anilistId || normalizeTitle(best.title);
  let multi = 0;
  trace.forEach((it) => {
    if ((it.anilistId || normalizeTitle(it.title)) === targetKey) multi += 1;
  });
  if (multi >= 2) signals.push('同作品 ' + multi + ' 条结果互相印证');

  const modelMatch = traceAligned(best, modelTitle);
  if (modelMatch) signals.push('与模型结果一致');

  /* 结果分散在多部作品且都逼近 100%，通常说明图片信息不足，属假命中 */
  const strongWorks = new Set();
  trace.forEach((it) => {
    if (it.similarity >= 98) strongWorks.add(it.anilistId || normalizeTitle(it.title));
  });
  if (strongWorks.size >= 3) {
    return {
      level: 'low',
      label: '存疑',
      signals,
      modelMatch,
      text: '结果分散在 ' + strongWorks.size + ' 部不同作品，且相似度都接近 100%，通常是图片信息不足造成的假命中，可信度低。'
    };
  }

  let level;
  let label;
  let text;
  if (best.similarity >= TRACE_SURE_SIM || (modelMatch && best.similarity >= TRACE_GOOD_SIM)) {
    level = 'high';
    label = '高可信';
    text = '多个信号指向同一作品，结论可信度较高。';
  } else if (best.similarity >= TRACE_GOOD_SIM || multi >= 2) {
    level = 'mid';
    label = '较可信';
    text = '只有单一强信号，建议结合下方以图搜图再确认一次。';
  } else {
    level = 'low';
    label = '存疑';
    text = '最佳相似度仅 ' + best.similarity + '%，画面可能被裁切、加了滤镜或并非电视动画，结论仅供参考。';
  }
  return { level, label, text, signals, modelMatch };
}

function renderFreeResult(payload) {
  const trace = payload.trace || [];
  const cross = payload.cross || { level: 'none', label: '未命中', text: '', signals: [] };
  const meta = payload.meta || {};
  const modelTitle = payload.modelTitle || '';
  const badgeCls = cross.level === 'high' ? 'badge-on' : cross.level === 'mid' ? 'badge-info' : 'badge-warn';

  $('resultSource').textContent = 'trace.moe · 免费溯源';
  $('resultSource').className = 'badge ' + badgeCls;

  let html = '<div class="cross-box cross-' + esc(cross.level) + '">' +
    '<div class="cross-head"><b>交叉认证</b><span class="badge ' + badgeCls + '">' + esc(cross.label) + '</span></div>' +
    '<p>' + esc(cross.text) + '</p>' +
    ((cross.signals || []).length
      ? '<div class="cross-signals">' + cross.signals.map((s) => '<span>' + esc(s) + '</span>').join('') + '</div>'
      : '') +
    '</div>';

  const chipsOf = (item, isBest) => {
    const chips = [];
    chips.push((isBest ? '最佳匹配 ' : '') + item.similarity + '% 相似');
    if (item.episode) chips.push('第 ' + item.episode + ' 话');
    if (item.at) chips.push('时间 ' + item.at + (item.to ? '–' + item.to : ''));
    if (item.episodes) chips.push('全 ' + item.episodes + ' 集');
    let out = '<div class="trace-meta">' + chips.map((c) => '<span>' + esc(c) + '</span>').join('');
    if (isBest && cross.modelMatch) out += '<span class="trace-hit">与模型结果一致</span>';
    return out + '</div>';
  };

  const linksOf = (item) => {
    const parts = [];
    if (item.anilistId) {
      parts.push('<a href="https://anilist.co/anime/' + encodeURIComponent(item.anilistId) + '" target="_blank" rel="noopener">AniList 条目</a>');
    }
    if (item.video) parts.push('<a href="' + esc(item.video) + '" target="_blank" rel="noopener">播放相似片段</a>');
    parts.push('<a href="https://bgm.tv/subject_search/' + encodeURIComponent(item.title) + '" target="_blank" rel="noopener">Bangumi 搜索</a>');
    return '<div class="trace-links">' + parts.join('') + '</div>';
  };

  if (trace.length) {
    const best = trace[0];
    const rest = trace.slice(1);
    html += '<p class="block-label">trace.moe · 动画</p>';
    html += '<div class="trace-hero">' +
      (best.image ? '<div class="trace-hero-thumb"><img src="' + esc(best.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>' : '') +
      '<div class="trace-hero-body">' +
      '<span class="trace-kicker">最佳匹配 · ' + esc(cross.label) + '</span>' +
      '<h2>' + esc(best.title) + '</h2>' +
      (best.alt ? '<p class="trace-sub">' + esc(best.alt) + '</p>' : '') +
      chipsOf(best, true) + linksOf(best) +
      '</div></div>';
    if (rest.length) {
      html += '<p class="trace-more">其他候选</p><div class="trace-list">' + rest.map((item) =>
        '<div class="trace-item">' +
        '<div class="trace-thumb">' + (item.image ? '<img src="' + esc(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '') + '</div>' +
        '<div class="trace-body"><h3>' + esc(item.title) + '</h3>' +
        (item.alt ? '<p class="trace-sub">' + esc(item.alt) + '</p>' : '') +
        chipsOf(item, false) + linksOf(item) +
        '</div></div>'
      ).join('') + '</div>';
    }
  }

  if (!trace.length) {
    html += '<div class="empty-state"><strong>没有可靠命中</strong><p>' + esc(cross.text) + '</p></div>';
  }

  if (cross.level === 'none' || cross.level === 'low') {
    const q = state.imageUrl ? encodeURIComponent(state.imageUrl) : '';
    const asciiHref = q ? 'https://ascii2d.net/search/url/' + q : 'https://ascii2d.net/';
    const yandexHref = q ? 'https://yandex.com/images/search?rpt=imageview&url=' + q : 'https://yandex.com/images/';
    html += '<div class="fallback-box"><p class="block-label">兜底检索</p>' +
      '<p class="fallback-note">自动来源没有可靠命中，可按顺序继续人工确认：先 ascii2d，再用 Yandex 兜底。' +
      (state.imageUrl ? '' : ' 上传的图片无法直接传给第三方，请先下载，再到站点内拖入。') + '</p>' +
      '<div class="search-row">' +
      '<a href="' + esc(asciiHref) + '" target="_blank" rel="noopener">① ascii2d 检索</a>' +
      '<a href="' + esc(yandexHref) + '" target="_blank" rel="noopener">② Yandex 图片兜底</a>' +
      (state.imageUrl ? '' : '<button class="btn btn-sm btn-ghost" type="button" onclick="downloadImage()">下载图片</button>') +
      '</div></div>';
  }

  const notes = [];
  if (meta.cached) notes.push('命中本地缓存，12 小时内不重复消耗额度');
  if (meta.fallback) notes.push('裁边模式无可靠命中，已自动改用整图重试');
  if (meta.rejected) notes.push('已过滤 ' + meta.rejected + ' 条低可信或不适内容结果');
  if (meta.lowDetail) notes.push('图片信息量过低，已跳过 trace.moe 以避免假命中');
  if (meta.quota) notes.push('今日 trace.moe 免费额度已用 ' + meta.quota.used + '/' + meta.quota.limit);
  if (meta.traceError) notes.push('trace.moe：' + meta.traceError);
  if (notes.length) html += '<p class="trace-note">' + esc(notes.join(' · ')) + '</p>';
  html += reverseSearchHtml();

  state.payload = payload;
  const lines = [];
  if (trace.length) {
    lines.push('trace.moe：' + trace[0].title +
      (trace[0].episode ? ' 第' + trace[0].episode + '话' : '') +
      ' · ' + trace[0].similarity + '%');
  }
  state.lastText = '【免费溯源 · 交叉认证：' + cross.label + '】\n' + lines.join('\n');
  $('resultBody').innerHTML = html;
  showResults();
}

async function handleFree() {
  if (!state.dataUrl || state.busy) return;
  const modelTitle = state.payload && state.payload.kind === 'model'
    ? (state.payload.data.title_cn || state.payload.data.title_original || '')
    : '';
  setBusy(true, '正在检索 trace.moe…');
  $('resultsPanel').hidden = true;
  try {
    const blob = dataUrlToBlob(state.dataUrl);
    const info = await imageInformativeness(state.dataUrl);
    const lowDetail = Boolean(info && info.variance < 40 && info.edge < 0.6);
    const traceRes = lowDetail
      ? { ok: true, items: [], lowDetail: true }
      : await runTrace(blob, hashImage(state.dataUrl));

    if (!traceRes.ok) {
      showError(traceRes.title || '免费溯源失败', traceRes.error, 'free');
      return;
    }

    const payload = {
      kind: 'free',
      trace: traceRes.items,
      modelTitle,
      cross: lowDetail
        ? {
          level: 'none',
          label: '无法比对',
          signals: [],
          modelMatch: false,
          text: '这张图片接近纯色或信息量极低，trace.moe 会给出虚假的高相似度，已阻止查询。请上传真实截图。'
        }
        : crossCheck(traceRes.items, modelTitle),
      meta: {
        cached: Boolean(traceRes.cached),
        fallback: Boolean(traceRes.fallback),
        quota: traceRes.quota || null,
        rejected: traceRes.rejected || 0,
        lowDetail
      }
    };
    renderFreeResult(payload);
    if (payload.trace[0]) {
      addHistory({ title: payload.trace[0].title, subtitle: '交叉认证 · ' + payload.cross.label, payload });
    }
  } finally {
    setBusy(false);
  }
}

/* ---------------- 共享图库 · 云端比对 ---------------- */

const libState = { items: [], ready: false, loading: false, error: '', compare: null };

function libReady() {
  return Boolean(LIB_CONFIG.url && LIB_CONFIG.key);
}

function libEndpoint(path) {
  return String(LIB_CONFIG.url).replace(/\/+$/, '') + path;
}

function libHeaders(extra) {
  return Object.assign({
    apikey: LIB_CONFIG.key,
    Authorization: 'Bearer ' + LIB_CONFIG.key
  }, extra || {});
}

async function libErrorText(res) {
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return (data && (data.message || data.error_description || data.hint)) || text;
    } catch (e) {
      return text || ('HTTP ' + res.status);
    }
  } catch (e) {
    return 'HTTP ' + res.status;
  }
}

function libThumbUrl(path) {
  if (!path) return '';
  return libEndpoint('/storage/v1/object/public/' + LIB_CONFIG.bucket + '/' + path);
}

/* 感知哈希：缩到 9×8 灰度，比较相邻像素亮度，得到 64 位指纹 */
function dHashFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = 9;
        const h = 8;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let bits = '';
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w - 1; x += 1) {
            const i = (y * w + x) * 4;
            const j = i + 4;
            const l1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const l2 = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
            bits += l1 > l2 ? '1' : '0';
          }
        }
        let hex = '';
        for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
        resolve(hex);
      } catch (e) {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

function hashSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 15;
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return Math.max(0, 1 - dist / 64);
}

function makeThumbBlob(dataUrl, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('图片压缩失败'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = dataUrl;
  });
}

function renderLibrary() {
  const panel = $('libraryPanel');
  panel.hidden = !libReady();
  if (!libReady()) return;

  const badge = $('libBadge');
  if (libState.loading) {
    badge.textContent = '连接中…';
    badge.className = 'badge badge-info';
  } else if (libState.error) {
    badge.textContent = '连接失败';
    badge.className = 'badge badge-warn';
  } else {
    badge.textContent = '云端 · ' + libState.items.length + ' 张';
    badge.className = 'badge badge-on';
  }

  $('btnLibUpload').disabled = !libState.ready;
  $('btnLibCompare').disabled = !libState.ready;

  const grid = $('libGrid');
  if (!libState.items.length) {
    grid.innerHTML = '<div class="lib-empty">' +
      (libState.error ? '图库连接失败：' + esc(libState.error) : '图库还没有内容，上传第一张截图吧。') +
      '</div>';
    return;
  }
  const list = libState.compare || libState.items.map((item) => ({ item, sim: null }));
  grid.innerHTML = list.slice(0, 60).map((entry) => {
    const item = entry.item;
    const sim = entry.sim;
    const tags = (item.tags || []).slice(0, 3).map((t) => '#' + t).join(' ');
    const simCls = sim == null ? '' : sim >= 0.85 ? ' hot' : sim >= 0.7 ? ' warm' : '';
    const simHtml = sim == null ? '' : '<span class="lib-sim' + simCls + '">' + Math.round(sim * 100) + '%</span>';
    const thumb = libThumbUrl(item.thumb_path);
    return '<a class="lib-card" href="' + esc(thumb) + '" target="_blank" rel="noopener">' +
      '<div class="lib-thumb"><img src="' + esc(thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' + simHtml + '</div>' +
      '<strong title="' + esc(item.title) + '">' + esc(item.title) + '</strong>' +
      '<span>' + esc(LIB_KIND_LABEL[item.kind] || '其他') + (tags ? ' · ' + esc(tags) : '') + '</span></a>';
  }).join('');
}

async function loadLibrary() {
  if (!libReady()) {
    renderLibrary();
    return;
  }
  if (libState.loading) return;
  libState.loading = true;
  libState.error = '';
  renderLibrary();
  try {
    const res = await fetch(libEndpoint('/rest/v1/' + LIB_CONFIG.table +
      '?select=id,title,tags,kind,hash,thumb_path,created_at&order=created_at.desc&limit=120'), {
      headers: libHeaders()
    });
    if (!res.ok) throw new Error(await libErrorText(res));
    const list = await res.json();
    libState.items = Array.isArray(list) ? list : [];
    libState.compare = null;
    libState.ready = true;
  } catch (err) {
    libState.ready = false;
    libState.error = (err && err.message) || '连接失败';
  } finally {
    libState.loading = false;
    renderLibrary();
  }
}

async function handleLibCompare() {
  if (!state.dataUrl) {
    toast('请先上传或载入一张图片');
    return;
  }
  if (!libReady()) {
    toast('共享图库尚未启用');
    return;
  }
  if (!libState.ready) await loadLibrary();
  if (!libState.ready) {
    toast('图库连接失败，请稍后重试');
    return;
  }
  $('btnLibCompare').disabled = true;
  try {
    const hash = await dHashFromDataUrl(state.dataUrl);
    if (!hash) {
      toast('图片解析失败，请换一张试试');
      return;
    }
    if (!libState.items.length) {
      libState.compare = null;
      $('libCompareResult').innerHTML = '<div class="lib-compare-box"><b>云端比对</b>' +
        '<p>图库还没有内容，先「存入共享图库」吧。</p></div>';
      renderLibrary();
      return;
    }
    const scored = libState.items
      .map((item) => ({ item, sim: hashSimilarity(hash, item.hash) }))
      .sort((a, b) => b.sim - a.sim);
    libState.compare = scored;
    const best = scored[0];
    const strong = scored.filter((s) => s.sim >= 0.8).length;
    const pct = Math.round(best.sim * 100);
    const hit = best.sim >= 0.7;
    $('libCompareResult').innerHTML = '<div class="lib-compare-box"><b>' +
      (hit ? '云端比对：最相似 ' + pct + '%' : '云端比对：未找到明显相似项（最高 ' + pct + '%）') + '</b>' +
      '<p>' + (hit
        ? esc(best.item.title) + (strong > 1 ? '，另有 ' + (strong - 1) + ' 张高度相近' : '') + '。'
        : '图库中没有构图接近的图片，可以换一张截图，或先存入更多素材。') +
      ' 比对基于感知哈希，只看画面结构，不理解内容。</p></div>';
    renderLibrary();
    $('libraryPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } finally {
    $('btnLibCompare').disabled = !libState.ready;
  }
}

function openLibModal() {
  if (!state.dataUrl) {
    toast('请先上传或载入一张图片');
    return;
  }
  if (!libReady()) {
    toast('共享图库尚未启用');
    return;
  }
  const payload = state.payload || {};
  const guess = payload.kind === 'model'
    ? (payload.data && (payload.data.title_cn || payload.data.title_original)) || ''
    : payload.kind === 'free' && payload.trace && payload.trace[0] ? payload.trace[0].title : '';
  $('libTitle').value = guess;
  $('libTags').value = '';
  $('libKind').value = 'anime';
  $('libUploadNote').textContent = '';
  $('libUploadNote').className = 'modal-note';
  $('btnLibSubmit').disabled = false;
  $('libModal').hidden = false;
  setTimeout(() => $('libTitle').focus(), 50);
}

function closeLibModal() {
  $('libModal').hidden = true;
}

function parseLibTags(text) {
  return String(text || '').split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
}

async function submitLibUpload() {
  const title = $('libTitle').value.trim();
  const note = $('libUploadNote');
  if (!title) {
    note.textContent = '请填写作品或角色名';
    note.className = 'modal-note err';
    return;
  }
  if (!libReady()) {
    note.textContent = '共享图库尚未启用';
    note.className = 'modal-note err';
    return;
  }
  const btn = $('btnLibSubmit');
  btn.disabled = true;
  note.textContent = '正在压缩图片…';
  note.className = 'modal-note';
  try {
    const hash = await dHashFromDataUrl(state.dataUrl);
    if (!hash) throw new Error('图片解析失败');
    const blob = await makeThumbBlob(state.dataUrl, 720, 0.72);
    const path = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
    note.textContent = '正在上传到云端…';
    const up = await fetch(libEndpoint('/storage/v1/object/' + LIB_CONFIG.bucket + '/' + path), {
      method: 'POST',
      headers: libHeaders({ 'Content-Type': 'image/jpeg' }),
      body: blob
    });
    if (!up.ok) throw new Error(await libErrorText(up));
    const ins = await fetch(libEndpoint('/rest/v1/' + LIB_CONFIG.table), {
      method: 'POST',
      headers: libHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        title: title.slice(0, 80),
        tags: parseLibTags($('libTags').value),
        kind: $('libKind').value,
        hash,
        thumb_path: path
      })
    });
    if (!ins.ok) throw new Error(await libErrorText(ins));
    closeLibModal();
    toast('已存入共享图库');
    libState.compare = null;
    $('libCompareResult').innerHTML = '';
    await loadLibrary();
    $('libraryPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    note.textContent = '上传失败：' + ((err && err.message) || '未知错误');
    note.className = 'modal-note err';
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 历史记录 ---------------- */

function readHistory() {
  try {
    const raw = localStorage.getItem(HIS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(HIS_KEY, JSON.stringify(list));
  } catch (e) {
    try {
      localStorage.setItem(HIS_KEY, JSON.stringify(list.slice(0, 3)));
    } catch (e2) { /* 放弃写入 */ }
  }
}

function addHistory(entry) {
  const list = readHistory();
  list.unshift({
    t: Date.now(),
    thumb: state.thumb,
    title: entry.title || '未命名',
    subtitle: entry.subtitle || '',
    payload: entry.payload
  });
  writeHistory(list.slice(0, MAX_HISTORY));
  renderHistory();
}

function renderHistory() {
  const list = readHistory();
  const panel = $('historyPanel');
  if (!list.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $('historyList').innerHTML = list.map((item, index) => {
    const date = new Date(item.t);
    const label = (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    const thumb = item.thumb ? '<img src="' + esc(item.thumb) + '" alt="" />' : '<div style="height:88px"></div>';
    return '<button class="history-item" type="button" data-index="' + index + '">' + thumb +
      '<div class="hi-body"><strong>' + esc(item.title) + '</strong><span>' + esc(label) +
      (item.subtitle ? ' · ' + esc(item.subtitle) : '') + '</span></div></button>';
  }).join('');
}

function restoreHistory(index) {
  const item = readHistory()[index];
  if (!item || !item.payload) return;
  if (item.thumb) {
    state.dataUrl = item.thumb;
    state.thumb = item.thumb;
    state.meta = '来自历史记录';
    state.imageUrl = '';
    renderPreview();
  }
  if (item.payload.kind === 'model') {
    renderModelResult(item.payload.data, item.payload.model, item.payload.thinking);
  } else if (item.payload.kind === 'free') {
    renderFreeResult(item.payload);
  }
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btnClear')) return;
    fileInput.click();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files && e.target.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'dragend'].forEach((type) => {
    dropzone.addEventListener(type, () => dropzone.classList.remove('drag'));
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const item of items) {
      if (item.type && item.type.indexOf('image/') === 0) {
        handleFile(item.getAsFile());
        toast('已粘贴剪贴板图片');
        return;
      }
    }
  });

  $('btnClear').addEventListener('click', (e) => {
    e.stopPropagation();
    clearImage();
  });
  $('btnUrl').addEventListener('click', handleUrl);
  $('urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUrl();
  });

  const promptInput = $('customPrompt');
  promptInput.value = readPrompt();
  let promptTimer = null;
  promptInput.addEventListener('input', () => {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => savePrompt(promptInput.value), 400);
  });

  const hintInput = $('hintInput');
  hintInput.value = readHint();
  let hintTimer = null;
  hintInput.addEventListener('input', () => {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => saveHint(hintInput.value), 400);
  });

  $('btnAnalyze').addEventListener('click', handleAnalyze);
  $('btnTrace').addEventListener('click', handleFree);

  $('btnRefreshDiscover').addEventListener('click', loadDiscover);
  $('discoverTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const target = tab.dataset.tab;
    document.querySelectorAll('#discoverTabs .tab').forEach((el) => {
      el.classList.toggle('active', el === tab);
    });
    $('animeGrid').hidden = target !== 'anime';
    $('latestGrid').hidden = target !== 'latest';
    $('gamesGrid').hidden = target !== 'games';
    if (target === 'latest' && !latestLoaded) loadLatestDiscover();
  });

  $('btnSettings').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('settingsModal').addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.close) closeSettings();
  });
  $('btnSaveSettings').addEventListener('click', handleSaveSettings);
  $('btnTest').addEventListener('click', handleTest);
  $('btnTestOnline').addEventListener('click', handleTestOnline);
  $('btnToggleKey').addEventListener('click', () => {
    const input = $('apiKey');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    $('btnToggleKey').textContent = isPassword ? '隐藏' : '显示';
  });

  $('presetSelect').addEventListener('change', (e) => {
    const preset = PRESETS[e.target.value];
    if (preset && preset.baseUrl) {
      $('baseUrl').value = preset.baseUrl;
      $('modelName').value = preset.model;
    }
    if (preset && isDeepSeekHost(preset.baseUrl) && isDeepSeekTextOnlyModel(preset.model)) {
      $('testResult').textContent = '提示：' + preset.model + ' 只支持文本，识图请选择 deepseek-flash。';
    } else if (preset) {
      $('testResult').textContent = '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('settingsModal').hidden) closeSettings();
    if (e.key === 'Escape' && !$('libModal').hidden) closeLibModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (state.dataUrl && !state.busy) handleAnalyze();
    }
  });

  $('resultBody').addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;
    if (action === 'retry' || action === 'analyze') {
      handleAnalyze();
    } else if (action === 'free') {
      handleFree();
    } else if (action === 'online-retry' && state.payload && state.payload.data) {
      enhanceOnline(state.payload.data);
    }
  });

  $('btnCopy').addEventListener('click', async () => {
    if (!state.lastText) return;
    try {
      await navigator.clipboard.writeText(state.lastText);
      toast('结果已复制');
    } catch (err) {
      toast('复制失败，请手动选择文本');
    }
  });

  $('historyList').addEventListener('click', (e) => {
    const button = e.target.closest('.history-item');
    if (!button) return;
    restoreHistory(Number(button.dataset.index));
  });
  $('btnClearHistory').addEventListener('click', () => {
    writeHistory([]);
    renderHistory();
    toast('历史记录已清空');
  });

  $('btnLibRefresh').addEventListener('click', loadLibrary);
  $('btnLibUpload').addEventListener('click', openLibModal);
  $('btnLibCompare').addEventListener('click', handleLibCompare);
  $('btnCloseLib').addEventListener('click', closeLibModal);
  $('btnLibCancel').addEventListener('click', closeLibModal);
  $('btnLibSubmit').addEventListener('click', submitLibUpload);
  $('libModal').addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.close) closeLibModal();
  });
}

/* ---------------- 最新番剧 / 新游上线 ---------------- */

const FREETOGAME_API = 'https://www.freetogame.com/api/games?sort-by=release-date';

const DISCOVER_ANIME_QUERY = `query ($season: MediaSeason, $year: Int) {
  Page(page: 1, perPage: 8) {
    media(type: ANIME, season: $season, seasonYear: $year, status: RELEASING, sort: POPULARITY_DESC) {
      id
      siteUrl
      title { native romaji english }
      synonyms
      coverImage { large }
      averageScore
      format
      episodes
      nextAiringEpisode { episode }
    }
  }
}`;

const DISCOVER_TRENDING_QUERY = `query {
  Page(page: 1, perPage: 8) {
    media(type: ANIME, status: RELEASING, sort: TRENDING_DESC) {
      id
      siteUrl
      title { native romaji english }
      synonyms
      coverImage { large }
      averageScore
      format
      episodes
      nextAiringEpisode { episode }
    }
  }
}`;

const DISCOVER_LATEST_QUERY = `query ($now: Int) {
  Page(page: 1, perPage: 24) {
    airingSchedules(airingAt_lesser: $now, sort: TIME_DESC) {
      episode
      airingAt
      media {
        id
        siteUrl
        title { native romaji english }
        synonyms
        coverImage { large }
        averageScore
        format
        isAdult
      }
    }
  }
}`;

function beijingMonthYear(date) {
  return {
    month: Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(date)),
    year: Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(date))
  };
}

function seasonOf(month) {
  if (month >= 3 && month <= 5) return { key: 'SPRING', label: '春季' };
  if (month >= 6 && month <= 8) return { key: 'SUMMER', label: '夏季' };
  if (month >= 9) return { key: 'FALL', label: '秋季' };
  return { key: 'WINTER', label: '冬季' };
}

function updateNetTime(serverDate) {
  const date = serverDate ? new Date(serverDate) : new Date();
  if (isNaN(date.getTime())) return;
  const label = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
  $('netTime').textContent = '联网时间 ' + label;
  $('netTime').className = 'badge badge-info';
}

function discoverSkeleton(count, wide) {
  let html = '';
  for (let i = 0; i < count; i += 1) {
    html += '<div class="d-skeleton"' + (wide ? ' style="aspect-ratio:16/9"' : '') + '></div>';
  }
  return html;
}

/* ---------- 发现区标题中文化（优先 AniList 中文别名，其次翻译，并持久缓存） ---------- */

const TITLE_ZH_KEY = 'anilens.titlezh.v1';
let titleZhMap = null;

function hasKana(text) {
  return /[\u3040-\u30ff]/.test(String(text || ''));
}

function titleNeedsZh(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (hasKana(raw)) return true;
  const han = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
  if (han / raw.length >= 0.6) return false;
  return /[A-Za-z]/.test(raw);
}

function loadTitleZh() {
  if (titleZhMap) return titleZhMap;
  titleZhMap = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(TITLE_ZH_KEY) || '{}') || {};
    Object.keys(raw).forEach((k) => titleZhMap.set(k, raw[k]));
  } catch (e) {
    /* 忽略 */
  }
  return titleZhMap;
}

function saveTitleZh() {
  try {
    const obj = {};
    Array.from(loadTitleZh().entries()).slice(-240).forEach(([k, v]) => { obj[k] = v; });
    localStorage.setItem(TITLE_ZH_KEY, JSON.stringify(obj));
  } catch (e) {
    /* 忽略写入失败 */
  }
}

function chineseSynonym(media) {
  const list = (media && media.synonyms) || [];
  return list.find((s) => {
    const text = String(s || '');
    const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return han >= 2 && !hasKana(text) && han / text.length >= 0.5;
  }) || '';
}

async function zhTitle(original) {
  const key = String(original || '').trim();
  if (!key) return '';
  if (!titleNeedsZh(key)) return key;
  const map = loadTitleZh();
  if (map.has(key)) return map.get(key);
  const zh = await translateRaw(key);
  if (zh && zh !== key) {
    map.set(key, zh);
    saveTitleZh();
  }
  return zh || key;
}

async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function localizeCardTitles(scope) {
  const nodes = Array.from(scope.querySelectorAll('.d-card strong[data-orig]'));
  if (!nodes.length) return;
  await runLimited(nodes.map((node) => async () => {
    const orig = node.getAttribute('data-orig') || '';
    if (!orig) return;
    const zh = await zhTitle(orig);
    if (zh && zh !== orig) node.textContent = zh;
  }), 3);
}

function animeCard(media) {
  const orig = pickMediaTitle(media.title);
  const preset = chineseSynonym(media);
  const display = preset || orig;
  const attr = preset || !titleNeedsZh(orig) ? '' : ' data-orig="' + esc(orig) + '"';
  const cover = media.coverImage && media.coverImage.large
    ? '<img src="' + esc(media.coverImage.large) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '';
  const score = media.averageScore ? '<span class="d-score">★ ' + (media.averageScore / 10).toFixed(1) + '</span>' : '';
  const info = media.nextAiringEpisode
    ? '第 ' + media.nextAiringEpisode.episode + ' 话'
    : (media.episodes ? media.episodes + ' 话' : (FORMAT_ZH[media.format] || media.format || '放送中'));
  return '<a class="d-card" href="' + esc(media.siteUrl || '#') + '" target="_blank" rel="noopener">' +
    '<div class="d-cover">' + cover + score + '</div>' +
    '<strong' + attr + ' title="' + esc(orig) + '">' + esc(display) + '</strong><span>' + esc(info) + '</span></a>';
}

function gameCard(game) {
  return '<a class="d-card" href="' + esc(game.game_url) + '" target="_blank" rel="noopener">' +
    '<div class="d-cover wide"><img src="' + esc(game.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>' +
    '<strong' + (titleNeedsZh(game.title) ? ' data-orig="' + esc(game.title) + '"' : '') + ' title="' + esc(game.title) + '">' + esc(game.title) + '</strong>' +
    '<span>' + esc([zhGenre(game.genre), game.release_date].filter(Boolean).join(' · ')) + '</span></a>';
}

function timeAgo(unixSeconds) {
  const at = Number(unixSeconds) || 0;
  const diff = Date.now() / 1000 - at;
  if (!isFinite(diff) || diff < 0) return '即将播出';
  if (diff < 60) return '刚刚更新';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 2) return '昨天';
  const d = new Date(at * 1000);
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

function latestCard(schedule) {
  const media = schedule.media || {};
  const orig = pickMediaTitle(media.title);
  const preset = chineseSynonym(media);
  const display = preset || orig;
  const attr = preset || !titleNeedsZh(orig) ? '' : ' data-orig="' + esc(orig) + '"';
  const cover = media.coverImage && media.coverImage.large
    ? '<img src="' + esc(media.coverImage.large) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '';
  const ep = schedule.episode ? '<span class="d-ep">第 ' + esc(String(schedule.episode)) + ' 话</span>' : '';
  const when = '<span class="d-time" data-at="' + esc(String(schedule.airingAt)) + '">' + esc(timeAgo(schedule.airingAt)) + '</span>';
  return '<a class="d-card" href="' + esc(media.siteUrl || '#') + '" target="_blank" rel="noopener">' +
    '<div class="d-cover">' + cover + ep + '</div>' +
    '<strong' + attr + ' title="' + esc(orig) + '">' + esc(display) + '</strong>' +
    '<span>' + when + '</span></a>';
}

async function loadAnimeDiscover() {
  const grid = $('animeGrid');
  const now = new Date();
  const { month, year } = beijingMonthYear(now);
  const season = seasonOf(month);
  try {
    let result = await anilistRequest(DISCOVER_ANIME_QUERY, { season: season.key, year });
    updateNetTime(result.serverDate);
    let list = (result.data && result.data.Page && result.data.Page.media) || [];
    if (!list.length) {
      result = await anilistRequest(DISCOVER_TRENDING_QUERY, {});
      list = (result.data && result.data.Page && result.data.Page.media) || [];
    }
    if (!list.length) throw new Error('empty');
    grid.innerHTML = list.slice(0, 8).map(animeCard).join('');
    localizeCardTitles(grid);
    $('discoverNote').textContent = '「本季新番」为 ' + year + ' ' + season.label + '新番；「最新新话」为全站最新已播出集数；数据来自 AniList 实时接口，游戏为 FreeToGame 免费游戏。';
  } catch (err) {
    grid.innerHTML = '<div class="d-empty">最新番剧加载失败，请点右上角「刷新」重试。</div>';
  }
}

async function loadGamesDiscover() {
  const grid = $('gamesGrid');
  try {
    const res = await fetch(FREETOGAME_API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    const games = (Array.isArray(list) ? list : [])
      .filter((g) => g && g.title && g.game_url && g.release_date && !isNaN(Date.parse(g.release_date)))
      .sort((a, b) => Date.parse(b.release_date) - Date.parse(a.release_date))
      .slice(0, 8);
    if (!games.length) throw new Error('empty');
    grid.innerHTML = games.map(gameCard).join('');
    localizeCardTitles(grid);
    updateNetTime(res.headers.get('date'));
  } catch (err) {
    grid.innerHTML = '<div class="d-empty">新游数据暂时无法获取，请点右上角「刷新」重试。</div>';
  }
}

async function loadLatestDiscover() {
  const grid = $('latestGrid');
  latestLoaded = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await anilistRequest(DISCOVER_LATEST_QUERY, { now });
    updateNetTime(result.serverDate);
    const schedules = (result.data && result.data.Page && result.data.Page.airingSchedules) || [];
    const seen = new Set();
    const list = [];
    schedules.forEach((item) => {
      const media = item && item.media;
      if (!media || media.isAdult) return;
      if (media.format === 'SPECIAL' || media.format === 'MUSIC') return;
      if (seen.has(media.id)) return;
      seen.add(media.id);
      list.push(item);
    });
    if (!list.length) throw new Error('empty');
    grid.innerHTML = list.slice(0, 8).map(latestCard).join('');
    localizeCardTitles(grid);
  } catch (err) {
    grid.innerHTML = '<div class="d-empty">最新新话加载失败，请点右上角「刷新」重试。</div>';
  }
}

function refreshLatestTimes() {
  document.querySelectorAll('#latestGrid .d-time[data-at]').forEach((el) => {
    el.textContent = timeAgo(el.getAttribute('data-at'));
  });
}

async function loadDiscover() {
  discoverLastLoad = Date.now();
  $('animeGrid').innerHTML = discoverSkeleton(8, false);
  $('gamesGrid').innerHTML = discoverSkeleton(8, true);
  if (latestLoaded) $('latestGrid').innerHTML = discoverSkeleton(8, false);
  $('btnRefreshDiscover').disabled = true;
  updateNetTime(new Date().toUTCString());
  const tasks = [loadAnimeDiscover(), loadGamesDiscover()];
  if (latestLoaded) tasks.push(loadLatestDiscover());
  await Promise.allSettled(tasks);
  $('btnRefreshDiscover').disabled = false;
}

/* ---------- 按当前时间动态更新 ---------- */

let discoverLastLoad = 0;
let latestLoaded = false;
const DISCOVER_STALE_MS = 15 * 60 * 1000;

function startNetClock() {
  setInterval(() => {
    updateNetTime(new Date());
    refreshLatestTimes();
  }, 30 * 1000);
}

function startDiscoverAutoRefresh() {
  // 页面重新可见且数据已过期时刷新（季度、放送集数会随时间变化）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - discoverLastLoad > DISCOVER_STALE_MS) loadDiscover();
  });
  setInterval(() => {
    if (!document.hidden && Date.now() - discoverLastLoad > DISCOVER_STALE_MS) loadDiscover();
  }, 60 * 1000);
}

/* ---------------- 示例结果（无 Key 预览） ---------------- */

const DEMO_RESULT = {
  found: true,
  confidence: 0.92,
  title_cn: '进击的巨人',
  title_original: '進撃の巨人',
  type: '番剧',
  year: '2013',
  creator: 'WIT STUDIO / MAPPA',
  synopsis: '人类龟缩在高墙之内，以逃避捕食同类的巨人。少年艾伦目睹家园被毁、母亲遇害后加入调查兵团，与三笠、阿尔敏一同追寻巨人的真相。',
  characters: ['艾伦·耶格尔', '三笠·阿克曼'],
  character: {
    name: '三笠·阿克曼',
    original_name: 'Mikasa Ackerman',
    from: '进击的巨人',
    role: '调查兵团士兵',
    description: '黑色短发、红色围巾、调查兵团制服，神情冷静',
    confidence: 0.88
  },
  scene: '调查兵团在墙外执行任务，立体机动装置高速移动的画面。',
  dialogue: '「何も捨てることができない人には、何も変えることはできない」',
  evidence: '画风、立体机动装置、调查兵团制服与绿色披风都是明显标志。',
  keywords: ['進撃の巨人', 'Attack on Titan'],
  character_profile: { hair: '深色', eyes: '灰蓝', outfit: '调查兵团制服', personality: ['坚韧', '冷静'] },
  similar_characters: [
    { name: '明日香·兰格雷', original_name: 'Asuka Langley Soryu', from: '新世纪福音战士', reason: '红色系战斗服与强势倔强的姿态相近' },
    { name: '朽木露琪亚', original_name: 'Rukia Kuchiki', from: '死神', reason: '短发、冷静而坚毅的战斗气质' },
    { name: 'Saber', original_name: 'Saber', from: 'Fate/stay night', reason: '骑士气质与制服感相近' }
  ],
  alternatives: [
    { title: '甲铁城的卡巴内瑞', type: '番剧', reason: '同为 WIT STUDIO 制作，画风接近' }
  ],
  note: '这是内置示例数据，用于展示联网增强与相似角色推荐效果。'
};

function maybeShowDemo() {
  if (!/[?&]demo=1/.test(window.location.search)) return;
  renderModelResult(DEMO_RESULT, '示例数据');
  setTimeout(() => toast('示例结果：作品资料与角色头像为联网实时查询'), 1000);
}

/* ---------------- 初始化 ---------------- */

function init() {
  buildPresetOptions();
  bindEvents();
  refreshBadge();
  renderPreview();
  renderHistory();
  renderLibrary();
  loadLibrary();
  loadDiscover();
  startNetClock();
  startDiscoverAutoRefresh();
  if (/[?&]demo=1/.test(window.location.search)) {
    maybeShowDemo();
    return;
  }
  const cfg = currentConfig();
  if (!cfg.apiKey) {
    setTimeout(() => toast('先点右上角「模型设置」填入 API Key'), 700);
  }
}

init();
