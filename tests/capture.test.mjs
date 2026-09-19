// notion-web-capture owns this file. See collaboration/CONTRACT.md and docs/research/capture.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  capturePage,
  WARNING_AMBIGUOUS_FEED,
  WARNING_EMPTY_BODY,
  WARNING_NO_AUTHOR,
  WARNING_NO_PERMALINK,
  WARNING_POST_MISMATCH,
  WARNING_TRUNCATED,
  MAX_TEXT_LENGTH,
  MAX_IMAGES
} from '../src/capture.js';
import { composeClip, normalizeUrl } from '../src/compose.js';

function withDom(html, url, fn) {
  const dom = new JSDOM(html, { url });
  const { window } = dom;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    URL: globalThis.URL,
    Node: globalThis.Node
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.URL = window.URL;
  globalThis.Node = window.Node;
  try {
    return fn(window);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.location = previous.location;
    globalThis.URL = previous.URL;
    globalThis.Node = previous.Node;
  }
}

function selectElementContents(window, el) {
  const range = window.document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectAcrossElements(window, startEl, endEl) {
  const range = window.document.createRange();
  range.setStart(startEl, 0);
  range.setEnd(endEl, endEl.childNodes.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

test('generic article page extracts source=article and preserves author/meta title', () => {
  const html = `<html><head><title>深度報導：城市規劃新方向</title>
    <meta name="author" content="王小明">
  </head><body>
    <nav>導覽列</nav>
    <article><h1>城市規劃新方向</h1><p>這是一篇關於城市規劃的完整內文，內容詳盡且具參考價值。</p></article>
  </body></html>`;
  withDom(html, 'https://news.example.com/a/1', () => {
    const result = capturePage();
    assert.equal(result.source, 'article');
    assert.match(result.text, /城市規劃/);
    assert.equal(result.author, '王小明');
    assert.equal(result.title, '深度報導：城市規劃新方向');
    assert.equal(result.warnings.length, 0);
    assert.equal(result.url, 'https://news.example.com/a/1');
  });
});

test('metadata fallback when no article/main and page is thin', () => {
  const html = `<html><head><title>首頁</title>
    <meta property="og:title" content="首頁精選">
    <meta property="og:description" content="這是首頁的簡短描述文字">
  </head><body><div>連結一 連結二</div></body></html>`;
  withDom(html, 'https://example.com/', () => {
    const result = capturePage();
    assert.equal(result.source, 'metadata');
    assert.equal(result.title, '首頁精選');
    assert.match(result.text, /首頁的簡短描述文字/);
  });
});

test('empty body produces WARNING_EMPTY_BODY', () => {
  const html = `<html><head><title>空頁面</title></head><body><div></div></body></html>`;
  withDom(html, 'https://example.com/empty', () => {
    const result = capturePage();
    assert.ok(result.warnings.includes(WARNING_EMPTY_BODY));
    assert.equal(result.text, '');
  });
});

test('user selection inside a generic article scopes extraction to the containing article', () => {
  const html = `<html><body>
    <article>
      <p id="target">選取的這一段內容應該被完整擷取出來。</p>
      <p>其餘段落也在同一篇文章內。</p>
    </article>
  </body></html>`;
  withDom(html, 'https://blog.example.com/post/1', (window) => {
    selectElementContents(window, window.document.getElementById('target'));
    const result = capturePage();
    assert.equal(result.source, 'selection');
    assert.match(result.text, /選取的這一段內容/);
    assert.match(result.text, /其餘段落也在同一篇文章內/);
  });
});

test('facebook single permalink post extracts author, text, and preserves story_fbid permalink', () => {
  const html = `<html><body>
    <div role="article">
      <h2><strong><a role="link" href="/profile.php?id=100000000001">陳大文</a></strong></h2>
      <div>今天天氣很好，跟大家分享一下最近的心得，這是一段完整的貼文內容。</div>
      <a href="https://www.facebook.com/permalink.php?story_fbid=987654321&id=100000000001">2 小時</a>
      <div role="toolbar"><span>942</span><span>12</span><span>5</span></div>
    </div>
  </body></html>`;
  withDom(
    html,
    'https://www.facebook.com/permalink.php?story_fbid=987654321&id=100000000001',
    () => {
      const result = capturePage();
      assert.equal(result.source, 'facebook');
      assert.equal(result.author, '陳大文');
      assert.match(result.text, /今天天氣很好/);
      assert.doesNotMatch(result.text, /942|留言|分享按鈕/);
      assert.match(result.url, /story_fbid=987654321/);
      assert.match(result.url, /id=100000000001/);
      assert.equal(result.warnings.length, 0);
    }
  );
});

test('facebook dialog (lightbox) single post is preferred even on a feed URL', () => {
  const html = `<html><body>
    <div role="article">Feed post A</div>
    <div role="article">Feed post B</div>
    <div role="dialog">
      <div role="article">
        <h2><strong><a role="link" href="/lin.chen">林晨</a></strong></h2>
        <div>這是在對話框中展開檢視的單一貼文內容。</div>
        <a href="https://www.facebook.com/lin.chen/posts/555111222">1 天</a>
      </div>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/', () => {
    const result = capturePage();
    assert.equal(result.source, 'facebook');
    assert.equal(result.author, '林晨');
    assert.match(result.text, /對話框中展開檢視的單一貼文內容/);
    assert.match(result.url, /\/lin\.chen\/posts\/555111222/);
    assert.ok(!result.warnings.includes(WARNING_AMBIGUOUS_FEED));
  });
});

test('facebook feed with multiple posts and no selection fails closed with WARNING_AMBIGUOUS_FEED', () => {
  const html = `<html><body>
    <div role="article">
      <div>貼文一內容</div>
      <a href="/posts/111">1 小時</a>
    </div>
    <div role="article">
      <div>貼文二內容</div>
      <a href="/posts/222">2 小時</a>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/', () => {
    const result = capturePage();
    assert.equal(result.source, 'facebook');
    assert.equal(result.text, '');
    assert.ok(result.warnings.includes(WARNING_AMBIGUOUS_FEED));
    assert.ok(
      result.warnings.includes(WARNING_EMPTY_BODY),
      'ambiguous feed capture must not silently fabricate a non-empty body'
    );
  });
});

test('facebook feed with no articles at all (still loading) fails closed too', () => {
  const html = `<html><body><div>Loading…</div></body></html>`;
  withDom(html, 'https://www.facebook.com/', () => {
    const result = capturePage();
    assert.equal(result.source, 'facebook');
    assert.equal(result.text, '');
    assert.ok(result.warnings.includes(WARNING_AMBIGUOUS_FEED));
  });
});

test('facebook post missing an author warns with WARNING_NO_AUTHOR', () => {
  const html = `<html><body>
    <div role="article">
      <div>沒有作者資訊的單一貼文內容。</div>
      <a href="/posts/999">3 小時</a>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/some/posts/999', () => {
    const result = capturePage();
    assert.equal(result.author, '');
    assert.ok(result.warnings.includes(WARNING_NO_AUTHOR));
  });
});

test('facebook permalink page matches the post by identity, not DOM order (regression for codex review round 1 P1)', () => {
  const html = `<html><body>
    <div role="article">
      <div>貼文111的內容，不應該被選到。</div>
      <a href="/posts/111">1 小時</a>
    </div>
    <div role="article">
      <h2><strong><a role="link" href="/some.user">王小美</a></strong></h2>
      <div>貼文222的正確內容，應該被擷取。</div>
      <a href="https://www.facebook.com/some.user/posts/222">2 小時</a>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/some.user/posts/222', () => {
    const result = capturePage();
    assert.equal(result.source, 'facebook');
    assert.match(result.text, /貼文222的正確內容/);
    assert.doesNotMatch(result.text, /貼文111/);
    assert.equal(result.author, '王小美');
    assert.match(result.url, /posts\/222/);
    assert.ok(!result.warnings.includes(WARNING_POST_MISMATCH));
    assert.ok(!result.warnings.includes(WARNING_AMBIGUOUS_FEED));
  });
});

test('facebook permalink page fails closed when no DOM article matches the URL post id', () => {
  const html = `<html><body>
    <div role="article">
      <div>這是另一篇不相關的貼文111。</div>
      <a href="/posts/111">1 小時</a>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/some.user/posts/999', () => {
    const result = capturePage();
    assert.equal(result.source, 'facebook');
    assert.equal(result.text, '');
    assert.ok(result.warnings.includes(WARNING_POST_MISMATCH));
    assert.ok(
      !/貼文111/.test(result.text),
      'must never fall back to an unrelated post\'s text just because it is the only one present'
    );
  });
});

test('selection spanning multiple facebook posts captures only the selected text, no cross-post author/permalink', () => {
  const html = `<html><body>
    <div id="wrap">
      <div role="article">
        <h2><strong><a role="link" href="/a">A使用者</a></strong></h2>
        <div id="postA">貼文A內容第一段。</div>
        <a href="/a/posts/1">1 小時</a>
      </div>
      <div role="article">
        <h2><strong><a role="link" href="/b">B使用者</a></strong></h2>
        <div id="postB">貼文B內容第一段。</div>
        <a href="/b/posts/2">2 小時</a>
      </div>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/', (window) => {
    const doc = window.document;
    selectAcrossElements(window, doc.getElementById('postA'), doc.getElementById('postB'));
    const result = capturePage();
    assert.equal(result.source, 'selection');
    assert.match(result.text, /貼文A內容第一段/);
    assert.match(result.text, /貼文B內容第一段/);
    assert.equal(result.author, '', 'author must not be scoped to either post when selection is ambiguous');
    assert.deepEqual(result.images, []);
    assert.equal(result.url, 'https://www.facebook.com/', 'must not guess either post\'s permalink');
    assert.ok(result.warnings.includes(WARNING_NO_PERMALINK));
  });
});

test('selection scoped to a single facebook post still resolves author and permalink', () => {
  const html = `<html><body>
    <div role="article">
      <h2><strong><a role="link" href="/a">A使用者</a></strong></h2>
      <p id="target">貼文A的完整段落內容在這裡。</p>
      <a href="/a/posts/1">1 小時</a>
    </div>
  </body></html>`;
  withDom(html, 'https://www.facebook.com/', (window) => {
    selectElementContents(window, window.document.getElementById('target'));
    const result = capturePage();
    assert.equal(result.source, 'selection');
    assert.equal(result.author, 'A使用者');
    assert.match(result.url, /\/a\/posts\/1/);
  });
});

test('overlong text is truncated to MAX_TEXT_LENGTH with WARNING_TRUNCATED', () => {
  const longText = '很長的內容。'.repeat(20000);
  const html = `<html><body><article><p>${longText}</p></article></body></html>`;
  withDom(html, 'https://example.com/long', () => {
    const result = capturePage();
    assert.equal(result.text.length, MAX_TEXT_LENGTH);
    assert.ok(result.warnings.includes(WARNING_TRUNCATED));
  });
});

test('images are capped at MAX_IMAGES and de-duplicated', () => {
  const imgs = Array.from({ length: 12 }, (_, i) => `<img src="https://img.example.com/${i % 5}.jpg">`).join('');
  const html = `<html><body><article><p>圖片文章內容</p>${imgs}</article></body></html>`;
  withDom(html, 'https://example.com/gallery', () => {
    const result = capturePage();
    assert.ok(result.images.length <= MAX_IMAGES);
    assert.equal(new Set(result.images).size, result.images.length);
  });
});

test('normalizeUrl strips tracking params, sorts remaining params, and lowercases host', () => {
  const a = normalizeUrl('https://WWW.Example.com/post?b=2&fbclid=abc&a=1&utm_source=fb');
  const b = normalizeUrl('https://www.example.com/post?utm_source=ig&a=1&b=2');
  assert.equal(a, 'https://www.example.com/post?a=1&b=2');
  assert.equal(a, b);
});

test('normalizeUrl preserves content-identifying params like story_fbid', () => {
  const result = normalizeUrl('https://www.facebook.com/permalink.php?story_fbid=123&id=456&fbclid=xyz');
  assert.match(result, /story_fbid=123/);
  assert.match(result, /id=456/);
  assert.doesNotMatch(result, /fbclid/);
});

test('normalizeUrl throws on empty or non-http(s) input', () => {
  assert.throws(() => normalizeUrl(''));
  assert.throws(() => normalizeUrl('not a url'));
  assert.throws(() => normalizeUrl('javascript:alert(1)'));
});

test('composeClip never uses a raw URL as the title and preserves original text verbatim', () => {
  const capture = {
    title: '',
    text: 'https://example.com/should-not-be-title 這裡才是真正的內文，說明一個具體事件的來龍去脈。',
    url: 'https://example.com/post/42?utm_source=test',
    siteName: 'example.com',
    author: '',
    images: [],
    warnings: [],
    source: 'article',
    capturedAt: '2026-09-20T00:00:00.000Z'
  };
  const clip = composeClip(capture);
  assert.notEqual(clip.title, capture.url);
  assert.doesNotMatch(clip.title, /^https?:\/\//);
  assert.equal(clip.text, capture.text, 'original text must be preserved verbatim');
  assert.equal(clip.url, 'https://example.com/post/42');
  assert.ok(clip.title.length <= 80);
  assert.ok(clip.summary.length <= 600);
  assert.equal(clip.aiUsed, false);
  assert.equal(clip.aiSummary, '');
  assert.deepEqual(clip.aiKeywords, []);
});

test('composeClip on an ambiguous facebook feed capture produces an honest placeholder, not fabricated content', () => {
  const capture = {
    title: '',
    text: '',
    url: 'https://www.facebook.com/',
    siteName: 'facebook.com',
    author: '',
    images: [],
    warnings: [WARNING_AMBIGUOUS_FEED, WARNING_EMPTY_BODY],
    source: 'facebook',
    capturedAt: '2026-09-20T00:00:00.000Z'
  };
  const clip = composeClip(capture);
  assert.match(clip.title, /待選取內容/);
  assert.match(clip.summary, /選取想擷取的貼文文字/);
  assert.deepEqual(clip.keywords, []);
});

test('composeClip builds a facebook-flavored title using author and first line', () => {
  const capture = {
    title: 'Facebook',
    text: '今天發表一個重要公告，內容如下：詳細說明省略。',
    url: 'https://www.facebook.com/permalink.php?story_fbid=1&id=2',
    siteName: 'facebook.com',
    author: '陳大文',
    images: [],
    warnings: [],
    source: 'facebook',
    capturedAt: '2026-09-20T00:00:00.000Z'
  };
  const clip = composeClip(capture);
  assert.match(clip.title, /^陳大文的貼文：/);
});

test('composeClip keyword extraction is deterministic for the same text', () => {
  const capture = {
    title: '測試',
    text: '人工智慧發展快速，人工智慧應用越來越多，機器學習與人工智慧密不可分。',
    url: 'https://example.com/ai',
    siteName: 'example.com',
    author: '',
    images: [],
    warnings: [],
    source: 'article',
    capturedAt: '2026-09-20T00:00:00.000Z'
  };
  const clip1 = composeClip(capture);
  const clip2 = composeClip(capture);
  assert.deepEqual(clip1.keywords, clip2.keywords);
  assert.ok(clip1.keywords.length > 0);
});

test('selected Facebook post derives topic from body instead of generic title, author or time', () => {
  const html = `<title>(2) Facebook</title><div role="article"><h2><a role="link" href="/doctor">王醫師</a></h2><div><a href="/doctor/posts/22">2 小時</a></div><p id="selected">糖尿病照護的新研究改善生活品質。</p><p>研究追蹤三年的結果值得關注。</p><div role="toolbar">讚 留言 分享</div></div>`;
  withDom(html, 'https://www.facebook.com/', window => {
    selectElementContents(window, window.document.getElementById('selected'));
    const captured = capturePage();
    const clip = composeClip(captured);
    assert.equal(clip.title, '王醫師的貼文：糖尿病照護的新研究改善生活品質。');
    assert.match(clip.summary, /^糖尿病照護/);
    assert.doesNotMatch(clip.summary, /2 小時|王醫師/);
    assert.equal(clip.text, captured.text, 'formatting the title/summary must preserve captured original');
  });
});

test('Facebook permalink matching ignores external lookalikes and matches a later valid post link', () => {
  const html = `<div role="article"><p>正確的貼文內容。</p><a href="https://blog.example/posts/222">外部文章</a><a href="https://facebook.com.evil.example/posts/222">相似網域</a><a href="/other/posts/111">引用的另一篇貼文</a><a href="/author/posts/222">1 小時</a></div>`;
  withDom(html, 'https://www.facebook.com/author/posts/222', () => {
    const captured = capturePage();
    assert.match(captured.text, /正確的貼文內容/);
    assert.equal(captured.url, 'https://www.facebook.com/author/posts/222');
  });
});

test('selected Facebook source cannot become an external /posts/ link', () => {
  withDom('<div role="article"><p id="selected">值得收藏的貼文。</p><a href="https://blog.example/posts/1">外部文章</a><a href="/permalink.php?story_fbid=22&id=33">1 小時</a></div>', 'https://www.facebook.com/', window => {
    selectElementContents(window, window.document.getElementById('selected'));
    assert.equal(capturePage().url, 'https://www.facebook.com/permalink.php?story_fbid=22&id=33');
  });
});

test('paragraph boundaries survive capture and hidden scripts/styles are excluded', () => {
  withDom('<article><h1>主題</h1><p>第一段<strong>保留行內文字</strong>。</p><p>第二段<br>換行內容。</p><script>secretScript()</script><style>.junk{color:red}</style><div hidden>hidden junk</div><div aria-hidden="true">aria junk</div><div style="display:none">style junk</div><div style="visibility:hidden">invisible junk</div></article>', 'https://example.com/story', () => {
    const captured = capturePage();
    assert.match(captured.text, /第一段保留行內文字。\n+第二段\n換行內容。/);
    assert.doesNotMatch(captured.text, /secretScript|junk/);
  });
});

test('images normalize relative sources and preserve a loaded responsive currentSrc', () => {
  withDom('<article><p>圖文內容</p><img src="/images/a.jpg"><img src="../b.jpg"><img id="responsive" src="fallback.jpg"><img src="data:image/png;base64,abc"><img src="javascript:alert(1)"></article>', 'https://example.com/stories/post', window => {
    Object.defineProperty(window.document.getElementById('responsive'), 'currentSrc', {value:'https://cdn.example.com/large.jpg'});
    assert.deepEqual(capturePage().images, ['https://example.com/images/a.jpg', 'https://example.com/b.jpg', 'https://cdn.example.com/large.jpg']);
  });
});
