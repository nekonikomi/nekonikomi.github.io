const FEEDS = [
  { source: "IGN Japan", url: "https://jp.ign.com/", type: "ignHome" },
  { source: "ファミ通.com", url: "https://www.famitsu.com/", type: "nextData" },
  { source: "電撃オンライン", url: "https://dengekionline.com/", type: "nextData" },
  { source: "4Gamer.net", url: "https://www.4gamer.net/rss/index.xml" },
  { source: "GAME Watch", url: "https://game.watch.impress.co.jp/data/rss/1.0/gmw/feed.rdf" },
  { source: "Game*Spark", url: "https://www.gamespark.jp/rss/index.rdf" },
  { source: "AUTOMATON", url: "https://automaton-media.com/feed/" },
  { source: "インサイド", url: "https://www.inside-games.jp/rss/index.rdf" }
];

const CACHE_KEY = "latest-game-news";
const MAX_ITEMS_PER_FEED = 12;
const MAX_TOTAL_ITEMS = 80;
const MAX_PAGE_IMAGE_LOOKUPS = 36;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname !== "/news") {
      return json({ ok: true, endpoints: ["/news"] }, 200);
    }

    const force = url.searchParams.get("refresh") === "1";
    const cached = !force ? await readCached(env) : null;
    if (cached) {
      return json(cached, 200, {
        "Cache-Control": "public, max-age=300, s-maxage=900"
      });
    }

    const payload = await collectNews();
    ctx.waitUntil(writeCached(env, payload));

    return json(payload, 200, {
      "Cache-Control": "public, max-age=300, s-maxage=900"
    });
  },

  async scheduled(_event, env, _ctx) {
    const payload = await collectNews();
    await writeCached(env, payload);
  }
};

async function collectNews() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const articles = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .filter((article) => article.title && article.link)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_TOTAL_ITEMS);

  await enrichArticleImages(articles);

  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason.message);

  return {
    updatedAt: new Date().toISOString(),
    sourceCount: FEEDS.length,
    articleCount: articles.length,
    articles,
    errors
  };
}

async function enrichArticleImages(articles) {
  const targets = articles
    .filter((article) => !article.image && article.link)
    .slice(0, MAX_PAGE_IMAGE_LOOKUPS);

  const results = await Promise.allSettled(targets.map(fetchPageImage));

  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      targets[index].image = result.value;
    }
  });
}

async function fetchFeed(feed) {
  if (feed.type === "ignHome") {
    return fetchIgnHomeFeed(feed);
  }

  if (feed.type === "nextData") {
    return fetchNextDataFeed(feed);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GameNewsHub/1.0 (+https://github.com/)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"
      }
    });

    if (!response.ok) {
      throw new Error(`${feed.source}: ${response.status}`);
    }

    const xml = await response.text();
    return parseFeed(xml, feed).slice(0, MAX_ITEMS_PER_FEED);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchIgnHomeFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GameNewsHub/1.0 (+https://github.com/)",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`${feed.source}: ${response.status}`);
    }

    const html = await response.text();
    const urls = readIgnItemListUrls(html).slice(0, MAX_ITEMS_PER_FEED);
    const results = await Promise.allSettled(urls.map((url) => fetchIgnArticle(url, feed)));

    return results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((article) => article.title && article.link);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchIgnArticle(url, feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GameNewsHub/1.0 (+https://github.com/)",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      return { source: feed.source, title: "", link: url };
    }

    const html = await response.text();
    return {
      source: feed.source,
      title: clean(readMetaContent(html, "property", "og:title") || readTitle(html)),
      link: url,
      publishedAt: toIso(
        readMetaContent(html, "property", "article:published_time") ||
        readMetaContent(html, "name", "date")
      ),
      image: absoluteUrl(readMetaImage(html), url),
      summary: summarize(readMetaContent(html, "property", "og:description") || readMetaContent(html, "name", "description"))
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNextDataFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GameNewsHub/1.0 (+https://github.com/)",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`${feed.source}: ${response.status}`);
    }

    const html = await response.text();
    return parseNextData(html, feed).slice(0, MAX_ITEMS_PER_FEED);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageImage(article) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(article.link, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GameNewsHub/1.0 (+https://github.com/)",
        "Accept": "text/html"
      }
    });

    if (!response.ok) return "";

    const html = await response.text();
    return absoluteUrl(readMetaImage(html), article.link);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeed(xml, feed) {
  const itemBlocks = matchBlocks(xml, "item");
  if (itemBlocks.length > 0) {
    return itemBlocks.map((block) => ({
      source: feed.source,
      title: clean(readTag(block, "title")),
      link: clean(readTag(block, "link")),
      publishedAt: toIso(readTag(block, "pubDate") || readTag(block, "dc:date")),
      image: absoluteUrl(readImage(block), feed.url),
      summary: summarize(readTag(block, "description") || readTag(block, "content:encoded"))
    }));
  }

  return matchBlocks(xml, "entry").map((block) => ({
    source: feed.source,
    title: clean(readTag(block, "title")),
    link: clean(readAtomLink(block)),
    publishedAt: toIso(readTag(block, "updated") || readTag(block, "published")),
    image: absoluteUrl(readImage(block), feed.url),
    summary: summarize(readTag(block, "summary") || readTag(block, "content"))
  }));
}

function parseNextData(html, feed) {
  const jsonText = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i)?.[1];
  if (!jsonText) return [];

  const data = JSON.parse(jsonText);
  const candidates = [];
  collectArticleCandidates(data, candidates);

  const seen = new Set();
  return candidates
    .map((item) => nextArticleToArticle(item, feed))
    .filter((article) => {
      if (!article.title || !article.link || seen.has(article.link)) return false;
      seen.add(article.link);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

function readIgnItemListUrls(html) {
  const scripts = html.match(/<script type=['"]application\/ld\+json['"]>([\s\S]*?)<\/script>/gi) || [];

  for (const script of scripts) {
    const jsonText = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(jsonText);
      if (data["@type"] === "ItemList" && Array.isArray(data.itemListElement)) {
        return data.itemListElement
          .map((item) => item.url)
          .filter(Boolean);
      }
    } catch {
      // Ignore non-article structured data blocks.
    }
  }

  return [];
}

function readTitle(html) {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function collectArticleCandidates(value, candidates) {
  if (!value || typeof value !== "object") return;

  if (!Array.isArray(value) && isNextArticleCandidate(value)) {
    candidates.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectArticleCandidates(child, candidates);
    }
  }
}

function isNextArticleCandidate(value) {
  return Boolean(
    (value.title || value.articleTitle) &&
    (value.publishedAt || value.articlePublishedAt || value.publicationTime) &&
    (value.id || value.articleId || value.link || value.articlePageLink || value.redirectUrl)
  );
}

function nextArticleToArticle(item, feed) {
  const id = item.id || item.articleId;
  const publishedAt = item.publishedAt || item.articlePublishedAt || item.publicationTime;
  const link = item.link || item.articlePageLink || item.redirectUrl || nextArticleLink(feed.url, id, publishedAt);

  return {
    source: feed.source,
    title: clean(item.title || item.articleTitle),
    link: absoluteUrl(link, feed.url),
    publishedAt: toIso(publishedAt),
    image: absoluteUrl(item.thumbnailUrl || item.ogpThumbnailUrl || item.campaignImage || item.imageUrl || "", feed.url),
    summary: summarize(item.description || "")
  };
}

function nextArticleLink(baseUrl, id, publishedAt) {
  if (!id || !publishedAt) return "";

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${new URL(baseUrl).origin}/article/${year}${month}/${id}`;
}

function matchBlocks(xml, tagName) {
  const blocks = [];
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "gi");
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

function readTag(xml, tagName) {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  return decodeEntities(stripCdata(xml.match(pattern)?.[1] || ""));
}

function readAtomLink(xml) {
  const hrefMatch = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return hrefMatch?.[1] || readTag(xml, "link");
}

function readImage(xml) {
  const mediaThumbnail = readAttribute(xml, "media:thumbnail", "url");
  const mediaContent = readAttribute(xml, "media:content", "url");
  const enclosure = readImageEnclosure(xml);
  const htmlImage = readFirstHtmlImage(readTag(xml, "description") || readTag(xml, "content:encoded") || readTag(xml, "content"));

  return clean(mediaThumbnail || mediaContent || enclosure || htmlImage);
}

function readMetaImage(html) {
  return clean(
    readMetaContent(html, "property", "og:image") ||
    readMetaContent(html, "name", "twitter:image") ||
    readMetaContent(html, "property", "twitter:image") ||
    readFirstHtmlImage(html)
  );
}

function readMetaContent(html, keyAttribute, keyValue) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const value = readAttributeFromTag(tag, keyAttribute);
    if (value.toLowerCase() === keyValue.toLowerCase()) {
      return readAttributeFromTag(tag, "content");
    }
  }

  return "";
}

function readImageEnclosure(xml) {
  const enclosureTag = xml.match(/<enclosure\b[^>]*>/i)?.[0] || "";
  const type = readAttributeFromTag(enclosureTag, "type");
  if (type && !type.toLowerCase().startsWith("image/")) return "";

  return readAttributeFromTag(enclosureTag, "url");
}

function readFirstHtmlImage(value) {
  const imageTag = stripCdata(value).match(/<img\b[^>]*>/i)?.[0] || "";
  return readAttributeFromTag(imageTag, "src");
}

function readAttribute(xml, tagName, attributeName) {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "i");
  return readAttributeFromTag(xml.match(pattern)?.[0] || "", attributeName);
}

function readAttributeFromTag(tag, attributeName) {
  const pattern = new RegExp(`${escapeRegExp(attributeName)}\\s*=\\s*["']([^"']+)["']`, "i");
  return decodeEntities(tag.match(pattern)?.[1] || "");
}

function summarize(value) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > 140 ? `${text.slice(0, 139)}...` : text;
}

function clean(value) {
  return decodeEntities(stripHtml(stripCdata(value || ""))).trim();
}

function stripCdata(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function toIso(value) {
  const date = new Date(clean(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readCached(env) {
  if (!env.NEWS_CACHE) return null;

  const cached = await env.NEWS_CACHE.get(CACHE_KEY, "json");
  if (!cached?.updatedAt) return null;

  const age = Date.now() - new Date(cached.updatedAt).getTime();
  return age < 1000 * 60 * 30 ? cached : null;
}

async function writeCached(env, payload) {
  if (!env.NEWS_CACHE) return;

  await env.NEWS_CACHE.put(CACHE_KEY, JSON.stringify(payload), {
    expirationTtl: 60 * 60
  });
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...headers
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
