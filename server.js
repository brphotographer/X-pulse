const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");


const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MASTODON_HOST = process.env.MASTODON_HOST || "mastodon.social";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CACHE_MS = 3 * 60 * 1000;
const YOUTUBE_CACHE_MS = 30 * 60 * 1000;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon" };
let cache = { key: "", at: 0, value: null };
let youtubeCache = { at: 0, posts: [] };
let cloudflareCache = { at: 0, posts: [] };

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
function decodeXml(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").trim();
}
function xmlTag(block, name) {
  const match = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}
function recordKey(uri = "") { return uri.split("/").pop() || ""; }
async function fetchJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "XPulsePublicMonitor/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}
async function fetchText(url, accept = "application/atom+xml, application/rss+xml, application/xml, text/xml") {
  const response = await fetch(url, { headers: { "Accept": accept, "User-Agent": "XPulsePublicMonitor/1.0 (public posts monitor)" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.text();
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
async function redditSearch(term) {
  const url = "https://www.reddit.com/search.rss?q=" + encodeURIComponent(term) + "&sort=new&t=day&limit=15";
  const xml = await fetchText(url);
  const blocks = xml.match(/<(?:entry|item)\b[\s\S]*?<\/(?:entry|item)>/gi) || [];
  return blocks.map((block, i) => {
    const title = xmlTag(block, "title"), content = xmlTag(block, "content") || xmlTag(block, "description");
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = linkMatch ? decodeXml(linkMatch[1]) : xmlTag(block, "link");
    const published = xmlTag(block, "published") || xmlTag(block, "pubDate");
    const author = xmlTag(block, "name") || xmlTag(block, "author");
    const subreddit = (link.match(/reddit\.com\/r\/([^/]+)/i) || [])[1];
    return { id: "reddit-" + (link || i), source: "Reddit", text: cleanHtml(title + (content ? " — " + content : "")),
      created_at: published || null, lang: "und", author: subreddit ? "r/" + subreddit : (author || "Conta pública"),
      url: link, public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 } };
  }).filter(p => p.text && p.url);
}
async function youtubeSearch() {
  if (!YOUTUBE_API_KEY) return [];
  if (youtubeCache.posts.length && Date.now() - youtubeCache.at < YOUTUBE_CACHE_MS) return youtubeCache.posts;
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet"); url.searchParams.set("type", "video");
  url.searchParams.set("order", "date"); url.searchParams.set("maxResults", "10");
  url.searchParams.set("q", 'apagão OR "sem internet" OR "queda de energia"');
  url.searchParams.set("key", YOUTUBE_API_KEY);
  const data = await fetchJson(url);
  const posts = (data.items || []).map(item => ({ id: "youtube-" + item.id.videoId, source: "YouTube",
    text: (item.snippet?.title || "") + (item.snippet?.description ? " — " + item.snippet.description : ""),
    created_at: item.snippet?.publishedAt || null, lang: "pt", author: item.snippet?.channelTitle || "Canal público",
    url: "https://www.youtube.com/watch?v=" + item.id.videoId,
    public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 } }));
  youtubeCache = { at: Date.now(), posts }; return posts;
}
async function cloudflareOutages() {
  if (!CLOUDFLARE_API_TOKEN) return [];
  if (cloudflareCache.posts.length && Date.now() - cloudflareCache.at < 5 * 60 * 1000) return cloudflareCache.posts;
  const url = "https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=7d&limit=50&format=json";
  const response = await fetch(url, { headers: { "Authorization": "Bearer " + CLOUDFLARE_API_TOKEN, "Accept": "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Cloudflare Radar HTTP " + response.status);
  const data = await response.json();
  if (!data.success) throw new Error("Cloudflare Radar não confirmou a consulta");
  const posts = (data.result?.annotations || []).map(item => {
    const locations = (item.locationsDetails || []).map(x => x.name || x.code).filter(Boolean);
    const cause = item.outage?.outageCause || "UNKNOWN";
    return {
      id: "cloudflare-" + item.id, source: "Cloudflare Radar",
      text: [item.scope, item.description, "Causa: " + cause.replace(/_/g, " ")].filter(Boolean).join(" — "),
      created_at: item.startDate || null, lang: "und", author: "Sinal técnico agregado",
      url: item.linkedUrl || "https://radar.cloudflare.com/",
      kind: "technical_signal", locations, country_codes: item.locations || [],
      outage_type: item.outage?.outageType || "UNKNOWN",
      public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 }
    };
  });
  cloudflareCache = { at: Date.now(), posts };
  return posts;
}

const EVENT_WORDS = /\b(outage|blackout|blackout|power cut|power outage|internet down|internet outage|service disruption|service down|downtime|failed|failure|crash|offline|apag[oã]o|corte de luz|queda de energia|sem energia|sem internet|ca[ií]da|falha|interrup[cç][aã]o|stromausfall|panne|coupure|apag[oó]n|corte el[eé]ctrico|ca[ií]da de internet|停電|障害)\b/i;
const DIGITAL_WORDS = /\b(bank|banking|chase|visa|mastercard|paypal|payment|payments|aws|azure|cloudflare|microsoft 365|office 365|google cloud|gmail|outlook|facebook|instagram|whatsapp|telegram|youtube|netflix|spotify|github|discord|united airlines|airline|airlines|telecom|carrier|mobile network|cellular|banco|bancos|pagamento|nuvem|servicio digital|servicio bancario)\b/i;
const POWER_WORDS = /\b(power|electric|electricity|grid|energy|substation|transformer|luz|energia|el[eé]ctrica|rede el[eé]trica|strom|elektrizit[aä]t|electricidad|energ[ií]a|停電)\b/i;
const CYBER_WORDS = /\b(cyber.?attack|ransomware|cyber incident|hack(ed|ing)?|ddos|malware|ataque cibern[eé]tico|incidente cibern[eé]tico|ataque inform[aá]tico)\b/i;
const SCHEDULED_WORDS = /\b(scheduled|planned|maintenance|programmed|corte programado|interrupci[oó]n programada|mantenimiento|programado|planificado|wartung|geplant)\b/i;
const RUMOR_WORDS = /\b(rumou?r|hoax|fake|unverified|supposed|alleged|ap[oó]calipse|apag[oó]n mundial|worldwide blackout|global blackout|conspiracy|rumor|supuesto|suposta|desinformaci[oó]n)\b/i;
const NOISE_WORDS = /\b(song lyrics|letra de la canci[oó]n|music video|what is a blackout|what is blackout|how does|explainer|guide to|article about|tariff|rates|price|precios|tarifas|börse|energiewende)\b/i;
function classifyPost(post) {
  const text = String(post.text || "");
  const isTechnical = post.kind === "technical_signal" || post.source === "Cloudflare Radar";
  let category = "infraestrutura";
  if (CYBER_WORDS.test(text)) category = "ciberseguranca";
  else if (DIGITAL_WORDS.test(text) && !POWER_WORDS.test(text)) category = "servicos_digitais";
  else if (POWER_WORDS.test(text)) category = "energia";
  else if (/internet|broadband|wifi|wi-fi|fiber|fibra|connectivity|conectividade|network|rede|telecom/i.test(text)) category = "conectividade";
  let status = "em_verificacao";
  let confidence = isTechnical ? "alta" : "baixa";
  if (NOISE_WORDS.test(text) && !EVENT_WORDS.test(text)) { status = "ruido"; confidence = "baixa"; }
  else if (RUMOR_WORDS.test(text)) { status = "rumor"; confidence = "baixa"; }
  else if (SCHEDULED_WORDS.test(text)) { status = "programado"; confidence = "media"; }
  else if (isTechnical) { status = "sinal_tecnico"; confidence = "alta"; }
  else if (EVENT_WORDS.test(text)) confidence = "media";
  else { status = "ruido"; confidence = "baixa"; }
  return { ...post, category, classification: status, confidence };
}
function tokensFor(post) {
  const stop = new Set(["the","and","for","with","that","this","from","have","has","was","were","are","its","after","before","una","uno","los","las","del","por","con","que","una","para","das","der","die","und","von","bei","em","uma","uns","dos","das","com","sobre","após","mais","sem","the"]);
  return new Set(String(post.text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/https?:\/\/\S+/g," ").replace(/[@#][\w.-]+/g," ").replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>2&&!stop.has(w)));
}
function groupIncidents(posts) {
  const candidates = posts.filter(p => p.classification !== "ruido");
  const groups = [];
  for (const post of candidates) {
    const tokens = tokensFor(post);
    let match = null;
    for (const group of groups) {
      if (group.category !== post.category) continue;
      const other = group.tokens;
      let overlap = 0;
      for (const token of tokens) if (other.has(token)) overlap++;
      const score = overlap / Math.max(1, Math.min(tokens.size, other.size));
      const sameLink = post.url && group.posts.some(p => p.url === post.url);
      if (sameLink || (score >= 0.72 && tokens.size >= 5)) { match = group; break; }
    }
    if (!match) groups.push({ category: post.category, tokens, posts: [post] });
    else { match.posts.push(post); for (const token of tokens) match.tokens.add(token); }
  }
  return groups.map((g,i) => {
    const id = "incident-" + (i+1);
    for (const post of g.posts) post.incident_group = id;
    return {
      id, category: g.category, classification: g.posts.some(p=>p.classification==="sinal_tecnico") ? "sinal_tecnico" : g.posts[0].classification,
      post_count: g.posts.length, sources: [...new Set(g.posts.map(p=>p.source))],
      latest_at: g.posts.map(p=>p.created_at).filter(Boolean).sort().at(-1) || null,
      title: (g.posts[0].text || "").slice(0,150), posts: g.posts
    };
  }).sort((a,b)=>b.post_count-a.post_count || String(b.latest_at).localeCompare(String(a.latest_at)));
}

async function getPosts(term) {
  const custom = String(term || "").trim().slice(0, 160), cacheKey = custom || "default";
  if (cache.value && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) return { ...cache.value, cached: true };
  const blueskyTerms = custom ? [custom] : ['"power outage"', '"internet outage"', '"blackout"', '"corte de luz"', '"caída de internet"', '"apagón"', '"panne internet"', '"stromausfall"', '"停電"', '"ネット障害"'];
  const mastodonTags = custom ? [] : ["poweroutage", "internetoutage", "blackout", "cortedeluz", "caidadeinternet", "apagón", "panneinternet", "stromausfall"];
  const redditTerms = custom ? [custom] : ['"power outage" OR "internet outage"', "blackout", '"corte de luz" OR "caída de internet" OR apagón', '"panne internet" OR stromausfall', '"停電" OR "ネット障害"'];
  const sources = {
    Bluesky: { status: "consultando", count: 0 }, Mastodon: { status: "consultando", count: 0 },
    Reddit: { status: "consultando", count: 0 },
    "Cloudflare Radar": { status: CLOUDFLARE_API_TOKEN ? "consultando" : "aguardando token opcional", count: 0 },
    YouTube: { status: YOUTUBE_API_KEY ? "consultando" : "aguardando chave de API", count: 0 }
  };
  const jobs = [
    ...blueskyTerms.map(term => blueskySearch(term).then(posts => ({ source: "Bluesky", posts }))),
    ...mastodonTags.map(tag => mastodonTag(tag).then(posts => ({ source: "Mastodon", posts }))),
    ...redditTerms.map(term => redditSearch(term).then(posts => ({ source: "Reddit", posts }))),
    ...(YOUTUBE_API_KEY ? [youtubeSearch().then(posts => ({ source: "YouTube", posts }))] : []),
    ...(CLOUDFLARE_API_TOKEN ? [cloudflareOutages().then(posts => ({ source: "Cloudflare Radar", posts }))] : [])
  ];
  const settled = await Promise.allSettled(jobs), posts = [], errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      posts.push(...result.value.posts); sources[result.value.source].count += result.value.posts.length;
    } else errors.push(result.reason?.message || "Falha na fonte");
  }
  for (const name of ["Bluesky", "Mastodon", "Reddit", "Cloudflare Radar"]) if (!sources[name].count && sources[name].status === "consultando") sources[name].status = "sem resultados ou indisponível";
  for (const name of ["Bluesky", "Mastodon", "Reddit", "Cloudflare Radar"]) if (sources[name].count) sources[name].status = "ok";
  if (sources.YouTube.count) sources.YouTube.status = "ok";
  else if (YOUTUBE_API_KEY) sources.YouTube.status = "sem resultados ou indisponível";
  const unique = [...new Map(posts.filter(p => p.text).map(p => [p.id, p])).values()]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 100)
    .map(classifyPost);
  const incidents = groupIncidents(unique);
  const value = { mode: "multi", posts: unique, incidents, result_count: unique.length,
    incident_count: incidents.length,
    classification_summary: {
      em_verificacao: unique.filter(p=>p.classification==="em_verificacao").length,
      sinal_tecnico: unique.filter(p=>p.classification==="sinal_tecnico").length,
      programado: unique.filter(p=>p.classification==="programado").length,
      rumor: unique.filter(p=>p.classification==="rumor").length,
      ruido: unique.filter(p=>p.classification==="ruido").length
    }, sources,
    warning: errors.length ? "Algumas consultas falharam. As fontes disponíveis continuam sendo exibidas." : "",
    note: "Monitoramento global experimental. Apenas conteúdo público e sinais técnicos disponíveis; YouTube e Cloudflare Radar exigem credenciais próprias. A cobertura varia por país, idioma e fonte.",
    updated_at: new Date().toISOString() };
  cache = { key: cacheKey, at: Date.now(), value }; return value;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return send(res, 200, { ok: true, service: "X PULSE", sources: ["Bluesky", "Mastodon", "Reddit", "YouTube", "Cloudflare Radar"] });
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
