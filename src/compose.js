// notion-web-capture owns this file. See collaboration/CONTRACT.md and docs/research/capture.md.
import { WARNING_AMBIGUOUS_FEED } from './capture.js';

const MAX_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 600;
const GENERIC_TITLE_FALLBACK = '未命名擷取內容';

// Known Facebook/marketing tracking params. Exact names are removed outright; the "utm_",
// "__tn__" and "__cft__" prefixes cover Facebook's dynamic per-click tracking params, which are
// widely documented by web developers inspecting shared FB links but are not spelled out in any
// single Meta/Facebook API reference (see docs/research/capture.md for sourcing notes). Anything
// not on this list (story_fbid, id, fbid, set, comment_id, v, t, ...) is preserved untouched.
const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'igsh',
  'mibextid',
  'ref',
  'ref_src',
  'ref_url',
  'spm',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'yclid',
  'twclid'
]);
const TRACKING_PARAM_PREFIXES = ['utm_', '__tn__', '__cft__'];

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Normalizes a capture URL into a stable http(s) string: lowercased host, default ports
 * stripped, tracking params removed, remaining params sorted for deterministic dedupe.
 * Pure function of the input string — the same URL always normalizes to the same output,
 * regardless of when it is normalized, so a value captured today and a page re-opened later
 * with the same underlying link normalize identically.
 */
export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('URL 不可為空');
  }
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch (err) {
    throw new Error('URL 格式無效');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('僅支援 http/https 網址');
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  const keptParams = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = '';
  for (const [key, value] of keptParams) {
    parsed.searchParams.append(key, value);
  }
  return parsed.toString();
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1).trimEnd()}…`;
}

function firstMeaningfulLine(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || '';
}

function looksLikeUrl(str) {
  return /^https?:\/\//i.test(str.trim());
}

function stripLeadingUrl(str) {
  return str.replace(/^\s*https?:\/\/\S+\s*/i, '').trim();
}

function isAmbiguousFeed(capture) {
  return Array.isArray(capture.warnings) && capture.warnings.includes(WARNING_AMBIGUOUS_FEED);
}

function isFacebookCapture(capture) {
  if (capture.source === 'facebook') return true;
  try {
    return capture.source === 'selection' && /(^|\.)(facebook\.com|fb\.watch)$/.test(new URL(capture.url).hostname);
  } catch { return false; }
}

function facebookBodyLines(capture) {
  const author = (capture.author || '').trim();
  return (capture.text || '').split(/\n+/).map(line => line.trim()).filter(line => {
    if (!line || line === author) return false;
    if (author && line.startsWith(author) && /^[\s·•]*(?:追蹤|Follow)?$/i.test(line.slice(author.length))) return false;
    if (/^(?:[·•.]+|Facebook|登入|註冊|Log in|Sign up|讚|留言|分享|Like|Comment|Share|追蹤|Follow|查看更多|顯示更多|See more)$/i.test(line)) return false;
    return !/^(?:\d[\d,.]*\s*[kKmM萬千]?|\d[\d,.]*\s*(?:則留言|次分享|likes?|comments?|shares?)|\d+\s*(?:秒|分鐘?|小時|天|週|個月|年)(?:前)?|\d+\s*(?:s|m|h|d|w|y|seconds?|minutes?|hours?|days?|weeks?|months?|years?)(?:\s+ago)?|剛剛|昨天|Just now|Yesterday)$/i.test(line);
  });
}

function buildTitle(capture) {
  const rawTitle = (capture.title || '').trim();
  const author = (capture.author || '').trim();
  const text = (capture.text || '').trim();
  const facebook = isFacebookCapture(capture);

  if (isAmbiguousFeed(capture) || !text) {
    if (facebook) {
      return truncate(author ? `${author}的貼文（待選取內容）` : 'Facebook 貼文（待選取內容）', MAX_TITLE_LENGTH);
    }
    if (rawTitle && !looksLikeUrl(rawTitle)) {
      return truncate(`${rawTitle}（待補充內容）`, MAX_TITLE_LENGTH);
    }
    return truncate('未擷取到內容（請重新選取）', MAX_TITLE_LENGTH);
  }

  if (facebook) {
    const snippet = facebookBodyLines(capture).map(stripLeadingUrl).find(Boolean) || '';
    const base = author
      ? `${author}的貼文：${snippet || '（內容為連結分享）'}`
      : `Facebook 貼文：${snippet || '（內容為連結分享）'}`;
    return truncate(base, MAX_TITLE_LENGTH);
  }

  if (rawTitle && !looksLikeUrl(rawTitle)) {
    return truncate(rawTitle, MAX_TITLE_LENGTH);
  }

  const snippet = stripLeadingUrl(firstMeaningfulLine(text));
  if (snippet) return truncate(snippet, MAX_TITLE_LENGTH);

  return truncate(capture.siteName ? `${capture.siteName} 擷取內容` : GENERIC_TITLE_FALLBACK, MAX_TITLE_LENGTH);
}

function buildSummary(capture) {
  const facebook = isFacebookCapture(capture);
  const text = facebook ? facebookBodyLines(capture).join('\n') : (capture.text || '').trim();
  if (!text) {
    return facebook
      ? '尚未擷取到貼文內容。請在 Facebook 頁面選取想擷取的貼文文字後再試一次。'
      : '尚未擷取到內容。請選取想擷取的文字後再試一次。';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  return truncate(normalized, MAX_SUMMARY_LENGTH);
}

const LATIN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'are', 'was',
  'were', 'will', 'your', 'you', 'about', 'into', 'then', 'than', 'they',
  'them', 'what', 'when', 'where', 'which', 'while', 'been', 'being', 'its',
  'our', 'out', 'not', 'but', 'can', 'all', 'has'
]);

function extractCjkBigramFrequency(text) {
  const runs = text.match(/[一-鿿]{2,}/g) || [];
  const freq = new Map();
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      freq.set(bigram, (freq.get(bigram) || 0) + 1);
    }
  }
  return freq;
}

function extractLatinWordFrequency(text) {
  const words = text.match(/[A-Za-z][A-Za-z0-9'-]{2,}/g) || [];
  const freq = new Map();
  for (const word of words) {
    const key = word.toLowerCase();
    if (LATIN_STOPWORDS.has(key)) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return freq;
}

/**
 * Deterministic, dependency-free keyword approximation: CJK text has no spaces to split on and
 * this project takes on no NLP/segmentation dependency, so we count overlapping 2-character CJK
 * runs (bigrams) plus 3+ letter Latin words and keep the most frequent, tie-broken alphabetically.
 * This is a coarse local stand-in for the optional AI keyword feature, not linguistic keyphrase
 * extraction.
 */
function buildKeywords(text) {
  if (!text) return [];
  const cjkFreq = extractCjkBigramFrequency(text);
  const latinFreq = extractLatinWordFrequency(text);
  const combined = [...cjkFreq.entries(), ...latinFreq.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const seen = new Set();
  const result = [];
  for (const [token] of combined) {
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
    if (result.length >= 8) break;
  }
  return result;
}

/**
 * composeClip(capture) never rewrites capture.text: the full original text captured by
 * capturePage() is preserved verbatim in the returned object's `text` field, per CONTRACT.md.
 */
export function composeClip(capture) {
  const url = normalizeUrl(capture.url);
  const title = buildTitle(capture);
  const summary = buildSummary(capture);
  const keywords = buildKeywords(capture.text || '');
  return {
    ...capture,
    url,
    title,
    summary,
    keywords,
    aiSummary: '',
    aiKeywords: [],
    aiUsed: false
  };
}
