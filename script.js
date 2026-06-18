const API_ENDPOINT = "https://game-news-worker.game-news-hub.workers.dev/news";

const fallbackArticles = [
  {
    source: "IGN Japan",
    title: "Worker の URL を設定すると、ここに最新記事が表示されます",
    link: "https://jp.ign.com/",
    publishedAt: new Date().toISOString(),
    image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80",
    summary: "script.js の API_ENDPOINT を Cloudflare Worker の公開 URL に置き換えてください。"
  },
  {
    source: "4Gamer.net",
    title: "Cloudflare Worker が複数の RSS をまとめて JSON 化します",
    link: "https://www.4gamer.net/",
    publishedAt: new Date().toISOString(),
    image: "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=900&q=80",
    summary: "Worker 側で取得元を増やせるので、サイト側は同じ API を読むだけで動きます。"
  }
];

const state = {
  articles: [],
  query: "",
  source: "all",
  updatedAt: null
};

const grid = document.getElementById("newsGrid");
const statusText = document.getElementById("statusText");
const updatedText = document.getElementById("updatedText");
const searchInput = document.getElementById("searchInput");
const sourceFilter = document.getElementById("sourceFilter");
const refreshButton = document.getElementById("refreshButton");
const template = document.getElementById("articleTemplate");

async function loadArticles() {
  statusText.textContent = "記事を読み込み中...";
  statusText.classList.remove("is-warning");
  refreshButton.disabled = true;

  try {
    if (API_ENDPOINT.includes("YOUR-WORKER")) {
      throw new Error("Worker URL is not configured.");
    }

    const response = await fetch(API_ENDPOINT, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`);
    }

    const data = await response.json();
    state.articles = Array.isArray(data.articles) ? data.articles : [];
    state.updatedAt = data.updatedAt || new Date().toISOString();
    statusText.textContent = `${state.articles.length}件の記事を表示しています`;
  } catch (error) {
    state.articles = fallbackArticles;
    state.updatedAt = new Date().toISOString();
    statusText.textContent = "Worker 接続前のプレビューを表示しています";
    statusText.classList.add("is-warning");
    console.info(error.message);
  } finally {
    refreshButton.disabled = false;
    populateSources();
    renderArticles();
  }
}

function populateSources() {
  const current = state.source;
  const sources = [...new Set(state.articles.map((article) => article.source).filter(Boolean))].sort();

  sourceFilter.innerHTML = '<option value="all">すべて</option>';
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    sourceFilter.append(option);
  }

  sourceFilter.value = sources.includes(current) ? current : "all";
  state.source = sourceFilter.value;
}

function renderArticles() {
  const filtered = state.articles.filter(matchesFilters);
  grid.replaceChildren();

  updatedText.textContent = state.updatedAt
    ? `更新: ${formatDateTime(state.updatedAt)}`
    : "";

  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "条件に合う記事がありません。";
    grid.append(empty);
    return;
  }

  for (const article of filtered) {
    const card = template.content.firstElementChild.cloneNode(true);
    const thumbnail = card.querySelector(".thumbnail");

    if (article.image) {
      thumbnail.src = article.image;
      thumbnail.alt = "";
      thumbnail.addEventListener("error", () => {
        thumbnail.remove();
      }, { once: true });
    } else {
      thumbnail.remove();
    }

    card.querySelector(".source").textContent = article.source || "Unknown";
    card.querySelector("time").textContent = formatRelative(article.publishedAt);
    card.querySelector("time").dateTime = article.publishedAt || "";
    card.querySelector("h2").textContent = article.title || "無題の記事";
    card.querySelector("p").textContent = article.summary || "概要はありません。";

    const link = card.querySelector("a");
    link.href = article.link || "#";
    link.setAttribute("aria-label", `${article.title || "記事"}を読む`);

    grid.append(card);
  }
}

function matchesFilters(article) {
  const haystack = [
    article.source,
    article.title,
    article.summary
  ].join(" ").toLowerCase();

  const matchesQuery = !state.query || haystack.includes(state.query.toLowerCase());
  const matchesSource = state.source === "all" || article.source === state.source;
  return matchesQuery && matchesSource;
}

function formatRelative(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}分前`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderArticles();
});

sourceFilter.addEventListener("change", (event) => {
  state.source = event.target.value;
  renderArticles();
});

refreshButton.addEventListener("click", loadArticles);

loadArticles();
