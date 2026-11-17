const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MASTODON_HOST = process.env.MASTODON_HOST || "mastodon.social";
const CACHE_MS = 3 * 60 * 1000;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon" };
let cache = { key: "", at: 0, value: null };

function send(res, status, data, type="application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function cleanHtml(value = "") {
  return String(value).replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/(p|div|li)>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'").replace(/\s+/g, " ").trim();
}
function recordKey(uri = "") { return uri.split("/").pop() || ""; }
async function fetchJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "XPulsePublicMonitor/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}
async function blueskySearch(term) {
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts");
  url.searchParams.set("q", term); url.searchParams.set("limit", "15"); url.searchParams.set("sort", "latest");
  const data = await fetchJson(url);
  return (data.posts || []).map(item => {
    const p = item.post || {}, handle = p.author?.handle || "", uri = p.uri || "", rkey = recordKey(uri);
    return { id: "bsky-" + (p.cid || uri), source: "Bluesky", text: p.record?.text || "",
      created_at: p.record?.createdAt || p.indexedAt || null, lang: p.record?.langs?.[0] || "und",
      author: handle ? "@" + handle : "Conta pública",
      url: handle && rkey ? "https://bsky.app/profile/" + encodeURIComponent(handle) + "/post/" + encodeURIComponent(rkey) : "https://bsky.app",
      public_metrics: { like_count: p.likeCount || 0, retweet_count: p.repostCount || 0, reply_count: p.replyCount || 0 } };
  });
}
async function mastodonTag(tag) {
  const url = "https://" + MASTODON_HOST + "/api/v1/timelines/tag/" + encodeURIComponent(tag) + "?limit=15";
  const data = await fetchJson(url);
  return (Array.isArray(data) ? data : []).filter(s => s.visibility === "public" && !s.reblog).map(s => ({
    id: "masto-" + s.id, source: "Mastodon", text: cleanHtml(s.content || ""), created_at: s.created_at || null,
    lang: s.language || "und", author: s.account?.acct ? "@" + s.account.acct : "Conta pública", url: s.url || "",
    public_metrics: { like_count: s.favourites_count || 0, retweet_count: s.reblogs_count || 0, reply_count: s.replies_count || 0 }
  }));
}
async function getPosts(term) {
  const custom = String(term || "").trim().slice(0, 160), cacheKey = custom || "default";
  if (cache.value && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) return { ...cache.value, cached: true };
  const blueskyTerms = custom ? [custom] : ["apagão", '"sem internet"', '"queda de energia"'];
  const mastodonTags = custom ? [] : ["apagao", "seminternet", "quedadeenergia"];
  const jobs = [
    ...blueskyTerms.map(term => blueskySearch(term).then(posts => ({ source: "Bluesky", posts }))),
    ...mastodonTags.map(tag => mastodonTag(tag).then(posts => ({ source: "Mastodon", posts })))
  ];
  const settled = await Promise.allSettled(jobs), posts = [], sources = {
    Bluesky: { status: "ok", count: 0 }, Mastodon: { status: "ok", count: 0 }
  };
  const errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      posts.push(...result.value.posts); sources[result.value.source].count += result.value.posts.length;
    } else errors.push(result.reason?.message || "Falha na fonte");
  }
  const unique = [...new Map(posts.filter(p => p.text).map(p => [p.id, p])).values()]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 80);
  if (!sources.Bluesky.count) sources.Bluesky.status = "sem resultados ou indisponível";
  if (!sources.Mastodon.count) sources.Mastodon.status = "sem resultados ou indisponível";
  const value = { mode: "multi", posts: unique, result_count: unique.length, sources,
    warning: errors.length ? "Algumas consultas falharam. As fontes disponíveis continuam sendo exibidas." : "",
    note: "Somente publicações públicas. A cobertura depende das buscas e das configurações de cada rede.",
    updated_at: new Date().toISOString() };
  cache = { key: cacheKey, at: Date.now(), value }; return value;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return send(res, 200, { ok: true, service: "X PULSE", sources: ["Bluesky", "Mastodon"] });
  if (url.pathname === "/api/posts") {
    try { return send(res, 200, await getPosts(url.searchParams.get("q"))); }
    catch (e) { return send(res, 502, { error: e.message || "Falha ao consultar fontes públicas" }); }
  }
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, data, MIME[path.extname(file)] || "application/octet-stream");
  });
});
server.listen(PORT, () => console.log("X PULSE disponível em http://localhost:" + PORT));
