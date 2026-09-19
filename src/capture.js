// notion-web-capture owns this file. See collaboration/CONTRACT.md and docs/research/capture.md.
//
// capturePage() is injected with browser.scripting.executeScript({func: capturePage}). Chrome's
// docs (https://developer.chrome.com/docs/extensions/reference/api/scripting) state the function
// "will be serialized, and then deserialized for injection" and "any bound parameters and
// execution context will be lost" — so capturePage() below must not close over anything in this
// module. The constants exported alongside it are separate string literals kept byte-identical to
// the copies declared inside capturePage(); they exist only so compose.js and peers can match on
// a stable token without capturePage() referencing an external binding.

export const WARNING_AMBIGUOUS_FEED =
  '這個頁面偵測到多篇貼文，無法確定要擷取哪一篇。請先選取想擷取的貼文文字，或開啟該則貼文的permalink頁面後再試一次。';
export const WARNING_EMPTY_BODY = '沒有擷取到任何內文。請選取想擷取的文字後再試一次。';
export const WARNING_NO_PERMALINK = '無法確認貼文的永久連結，已使用目前頁面網址。';
export const WARNING_TRUNCATED = '內容過長，已截斷至字數上限。';
export const WARNING_NO_AUTHOR = '無法辨識作者，欄位留空。';
export const WARNING_POST_MISMATCH =
  '找不到與目前網址相符的貼文內容，可能是頁面尚未載入完成或內容已變更。請重新整理頁面或選取想擷取的貼文文字後再試一次。';

export const MAX_TEXT_LENGTH = 80000;
export const MAX_IMAGES = 8;

export function capturePage() {
  var MAX_TEXT_LENGTH = 80000;
  var MAX_IMAGES = 8;
  var WARNING_AMBIGUOUS_FEED =
    '這個頁面偵測到多篇貼文，無法確定要擷取哪一篇。請先選取想擷取的貼文文字，或開啟該則貼文的permalink頁面後再試一次。';
  var WARNING_EMPTY_BODY = '沒有擷取到任何內文。請選取想擷取的文字後再試一次。';
  var WARNING_NO_PERMALINK = '無法確認貼文的永久連結，已使用目前頁面網址。';
  var WARNING_TRUNCATED = '內容過長，已截斷至字數上限。';
  var WARNING_NO_AUTHOR = '無法辨識作者，欄位留空。';
  var WARNING_POST_MISMATCH =
    '找不到與目前網址相符的貼文內容，可能是頁面尚未載入完成或內容已變更。請重新整理頁面或選取想擷取的貼文文字後再試一次。';

  function cleanText(str) {
    return String(str || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(function (line) {
        return line.replace(/^[ \t]+|[ \t]+$/g, '');
      })
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function toAbsoluteUrl(href) {
    try {
      return new URL(href, location.href).toString();
    } catch (err) {
      return null;
    }
  }

  function findPermalinkFromContainer(container, expectedId) {
    var selectors = [
      'a[href*="/posts/"]',
      'a[href*="/videos/"]',
      'a[href*="/photo.php"]',
      'a[href*="/photo/"]',
      'a[href*="permalink.php"]',
      'a[href*="story.php"]',
      'a[href*="story_fbid="]',
      'a[href*="?fbid="]',
      'a[href*="&fbid="]',
      'a[href*="/watch/"]',
      'a[href*="/reel/"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var links = container.querySelectorAll(selectors[i]);
      for (var j = 0; j < links.length; j++) {
        var href = toAbsoluteUrl(links[j].getAttribute('href'));
        if (!href) continue;
        var parsed = new URL(href);
        // A shared external article may itself contain /posts/ in its URL.
        // It is never the Facebook source permalink.
        if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)facebook\.com$/.test(parsed.hostname)) continue;
        if (!expectedId || extractPostId(href) === expectedId) return href;
      }
    }
    return null;
  }

  function extractPostId(str) {
    if (!str) return null;
    var s = String(str);
    var m;
    m = s.match(/[?&]story_fbid=([^&#]+)/);
    if (m) return 'story_fbid:' + m[1];
    m = s.match(/\/posts\/([^/?&#]+)/);
    if (m) return 'posts:' + m[1];
    m = s.match(/\/videos\/([^/?&#]+)/);
    if (m) return 'videos:' + m[1];
    m = s.match(/\/reel\/([^/?&#]+)/);
    if (m) return 'reel:' + m[1];
    m = s.match(/[?&]fbid=([^&#]+)/);
    if (m) return 'fbid:' + m[1];
    m = s.match(/[?&]v=([^&#]+)/);
    if (m) return 'watch:' + m[1];
    return null;
  }

  function findAuthorFromContainer(container) {
    var candidates = [
      '[data-ad-rendering-role="profile_name"] a',
      '[data-ad-rendering-role="profile_name"]',
      'h2 a[role="link"]',
      'h3 a[role="link"]',
      'strong a[role="link"]',
      'header a[role="link"]',
      'h2 strong a',
      'h3 strong a'
    ];
    for (var i = 0; i < candidates.length; i++) {
      var el = container.querySelector(candidates[i]);
      var text = el && el.textContent && el.textContent.replace(/^\s+|\s+$/g, '');
      if (text) return text;
    }
    var meta =
      document.querySelector('meta[property="article:author"]') ||
      document.querySelector('meta[name="author"]');
    var metaContent = meta && meta.getAttribute('content');
    if (metaContent) return metaContent.replace(/^\s+|\s+$/g, '');
    var relAuthor = document.querySelector('[rel="author"], [itemprop="author"]');
    var relText = relAuthor && relAuthor.textContent && relAuthor.textContent.replace(/^\s+|\s+$/g, '');
    if (relText) return relText;
    return '';
  }

  function stripChrome(container) {
    var clone = container.cloneNode(true);
    var originalImages = container.querySelectorAll('img');
    var clonedImages = clone.querySelectorAll('img');
    for (var imageIndex = 0; imageIndex < originalImages.length; imageIndex++) {
      if (originalImages[imageIndex].currentSrc) clonedImages[imageIndex].setAttribute('src', originalImages[imageIndex].currentSrc);
    }
    var removeSelectors = [
      'script', 'style', 'noscript', 'template', 'svg',
      '[hidden]', '[aria-hidden="true"]',
      '[role="toolbar"]',
      '[role="navigation"]',
      'nav',
      'form',
      'button',
      '[aria-label*="讚"]',
      '[aria-label*="留言"]',
      '[aria-label*="分享"]',
      '[aria-label*="Like"]',
      '[aria-label*="Comment"]',
      '[aria-label*="Share"]',
      '[aria-label*="留言" i]'
    ];
    for (var i = 0; i < removeSelectors.length; i++) {
      var found = clone.querySelectorAll(removeSelectors[i]);
      for (var j = 0; j < found.length; j++) {
        found[j].parentNode && found[j].parentNode.removeChild(found[j]);
      }
    }
    var styled = clone.querySelectorAll('[style]');
    for (var styleIndex = 0; styleIndex < styled.length; styleIndex++) {
      if (styled[styleIndex].style.display === 'none' || styled[styleIndex].style.visibility === 'hidden') styled[styleIndex].remove();
    }
    return clone;
  }

  function extractText(el) {
    // textContent joins adjacent paragraphs and author/body/time into one line.
    // Preserve semantic boundaries without innerText's detached-clone behavior.
    var parts = [];
    function visit(node) {
      if (node.nodeType === 3) { parts.push(node.nodeValue || ''); return; }
      if (node.nodeType !== 1) return;
      var block = /^(ARTICLE|DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE|SECTION|HEADER|FOOTER|PRE|TR|TD|TH)$/.test(node.tagName);
      if (block || node.tagName === 'BR') parts.push('\n');
      for (var child = node.firstChild; child; child = child.nextSibling) visit(child);
      if (block) parts.push('\n');
    }
    visit(el);
    return cleanText(parts.join(''));
  }

  function extractImages(container) {
    var imgs = container.querySelectorAll('img');
    var seen = [];
    for (var i = 0; i < imgs.length && seen.length < MAX_IMAGES; i++) {
      var src = imgs[i].currentSrc || imgs[i].getAttribute('src');
      var absolute = src && toAbsoluteUrl(src);
      if (absolute && /^https?:\/\//i.test(absolute) && seen.indexOf(absolute) === -1) seen.push(absolute);
    }
    return seen;
  }

  function nearestBlock(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    var selectorList = ['[role="article"]', 'article', 'main', '[role="main"]'];
    while (el && el !== document.body && el !== document.documentElement) {
      for (var i = 0; i < selectorList.length; i++) {
        if (el.matches && el.matches(selectorList[i])) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  var warnings = [];
  var source = 'metadata';
  var title = '';
  var text = '';
  var author = '';
  var images = [];
  var url = location.href;
  var siteName = location.hostname.replace(/^www\./, '');

  var selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
  var selectedText = selection ? cleanText(selection.toString()) : '';

  var hostname = location.hostname.toLowerCase();
  var isFacebook = /(^|\.)facebook\.com$/.test(hostname) || /(^|\.)fb\.watch$/.test(hostname);

  if (selectedText) {
    source = 'selection';
    var range = selection.getRangeAt(0);
    var container =
      nearestBlock(range.commonAncestorContainer) ||
      (range.commonAncestorContainer.nodeType === 3
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer) ||
      document.body;
    // If the selection's containing block still wraps more than one post (e.g. the selection
    // crosses a post boundary and nearestBlock only found a shared main/body ancestor), only the
    // selected text itself is trustworthy — do not read the whole container's text, and don't
    // guess which post's author/permalink applies.
    var multiPostSpan = !!(container.querySelectorAll && container.querySelectorAll('[role="article"]').length > 1);
    if (multiPostSpan) {
      text = selectedText;
      author = '';
      images = [];
      if (isFacebook) warnings.push(WARNING_NO_PERMALINK);
    } else {
      var cleanContainer = stripChrome(container);
      text = extractText(cleanContainer) || selectedText;
      author = findAuthorFromContainer(container);
      images = extractImages(cleanContainer);
      if (isFacebook) {
        var permalinkHref = findPermalinkFromContainer(container);
        if (permalinkHref) {
          url = toAbsoluteUrl(permalinkHref) || url;
        } else {
          warnings.push(WARNING_NO_PERMALINK);
        }
      }
    }
    title = (document.title || '').trim();
  } else if (isFacebook) {
    source = 'facebook';
    var dialogArticle = document.querySelector('[role="dialog"] [role="article"]');
    var permalinkPatterns = /\/(posts|videos|photo\.php|photo|permalink\.php|story\.php|watch|reel)\b|story_fbid=|[?&]fbid=/;
    var isPermalinkUrl = permalinkPatterns.test(location.pathname + location.search);
    var articles = document.querySelectorAll('[role="article"]');
    var targetArticle = null;

    if (dialogArticle) {
      targetArticle = dialogArticle;
    } else if (isPermalinkUrl) {
      var currentPostId = extractPostId(location.pathname + location.search);
      if (articles.length === 1 && !currentPostId) {
        // Permalink-shaped URL (e.g. a vanity-username permalink) we can't extract an id from,
        // and exactly one post rendered — reasonable single-post evidence.
        targetArticle = articles[0];
      } else {
        for (var ai = 0; ai < articles.length; ai++) {
          var candidateHref = findPermalinkFromContainer(articles[ai], currentPostId);
          var candidateId = candidateHref && extractPostId(candidateHref);
          if (currentPostId && candidateId && candidateId === currentPostId) {
            targetArticle = articles[ai];
            break;
          }
        }
        if (!targetArticle) {
          // Multiple (or zero) posts rendered and none verifiably matches the URL's post id —
          // fail closed instead of guessing an unrelated post (e.g. articles[0]).
          warnings.push(WARNING_POST_MISMATCH);
        }
      }
    } else if (articles.length === 1) {
      targetArticle = articles[0];
    } else {
      warnings.push(WARNING_AMBIGUOUS_FEED);
    }

    title = (document.title || '').trim();

    if (targetArticle) {
      var cleaned = stripChrome(targetArticle);
      text = extractText(cleaned);
      author = findAuthorFromContainer(targetArticle);
      images = extractImages(cleaned);
      var permalinkHref2 = findPermalinkFromContainer(targetArticle, isPermalinkUrl && !dialogArticle ? currentPostId : null);
      if (permalinkHref2) {
        url = toAbsoluteUrl(permalinkHref2) || url;
      } else if (!isPermalinkUrl) {
        warnings.push(WARNING_NO_PERMALINK);
      }
    }
  } else {
    var articleEl = document.querySelector('article');
    var main = !articleEl && (document.querySelector('main') || document.querySelector('[role="main"]'));
    var candidateEl = articleEl || (main && cleanText(main.textContent || '').length > 200 ? main : null);

    if (candidateEl) {
      source = 'article';
      var cleanedGeneric = stripChrome(candidateEl);
      text = extractText(cleanedGeneric);
      images = extractImages(cleanedGeneric);
      author = findAuthorFromContainer(document);
      title = (document.title || '').trim();
    } else {
      source = 'metadata';
      var ogTitle = document.querySelector('meta[property="og:title"]');
      var ogDesc =
        document.querySelector('meta[property="og:description"]') ||
        document.querySelector('meta[name="description"]');
      var ogTitleContent = ogTitle && ogTitle.getAttribute('content');
      var ogDescContent = ogDesc && ogDesc.getAttribute('content');
      title = (ogTitleContent || document.title || '').trim();
      text = cleanText(ogDescContent || '');
      author = findAuthorFromContainer(document);
    }
  }

  if (!text) warnings.push(WARNING_EMPTY_BODY);

  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH);
    warnings.push(WARNING_TRUNCATED);
  }

  if (!author && source === 'facebook') warnings.push(WARNING_NO_AUTHOR);

  if (!title) title = siteName || '未命名頁面';

  return {
    title: title,
    text: text,
    url: url,
    siteName: siteName,
    author: author,
    images: images,
    warnings: warnings,
    source: source,
    capturedAt: new Date().toISOString()
  };
}
