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
let gdeltCache = { at: 0, posts: [] };
let nwsCache = { at: 0, posts: [] };
let usgsCache = { at: 0, posts: [] };
let officialCache = new Map();

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


const STATUS_PAGES = [
  { name: "Cloudflare Status", host: "www.cloudflarestatus.com" },
  { name: "GitHub Status", host: "www.githubstatus.com" },
  { name: "Fastly Status", host: "status.fastly.com" },
  { name: "DigitalOcean Status", host: "status.digitalocean.com" },
  { name: "Atlassian Status", host: "status.atlassian.com" },
  { name: "OpenAI Status", host: "status.openai.com" },
  { name: "Discord Status", host: "discordstatus.com" },
  { name: "Zoom Status", host: "status.zoom.us" },
  { name: "Stripe Status", host: "status.stripe.com" },
  { name: "Twilio Status", host: "status.twilio.com" },
  { name: "npm Status", host: "status.npmjs.org" },
  { name: "GitLab Status", host: "status.gitlab.com" }
];
async function statusPageIncidents(page) {
  const cached = officialCache.get(page.host);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.posts;
  const url = "https://" + page.host + "/api/v2/incidents/unresolved.json";
  const data = await fetchJson(url);
  const posts = (data.incidents || []).map(item => {
    const components = (item.components || []).map(x => x.name).filter(Boolean);
    const updates = (item.incident_updates || []).slice(0, 2).map(x => cleanHtml(x.body || "")).filter(Boolean);
    const impact = item.impact || "unknown";
    return {
      id: "status-" + page.host + "-" + item.id, source: page.name,
      text: [item.name, "Impacto: " + impact, "Status: " + (item.status || "indefinido"), components.length ? "Componentes: " + components.join(", ") : "", updates.join(" — ")].filter(Boolean).join(" — ").slice(0, 1000),
      created_at: item.created_at || item.updated_at || null, lang: "en", author: "Status oficial do provedor",
      url: item.shortlink || ("https://" + page.host), kind: "official_status", impact,
      public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 }
    };
  });
  officialCache.set(page.host, { at: Date.now(), posts });
  return posts;
}
async function googleCloudIncidents() {
  const cached = officialCache.get("google-cloud");
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.posts;
  const data = await fetchJson("https://status.cloud.google.com/incidents.json");
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const posts = (Array.isArray(data) ? data : []).filter(item => {
    const started = Date.parse(item.begin || item.created || "");
    return !Number.isFinite(started) || started >= cutoff;
  }).slice(0, 30).map(item => {
    const updates = (item.updates || []).slice(0, 2).map(x => cleanHtml(x.text || x.description || "")).filter(Boolean);
    const services = (item.affected_products || []).map(x => x.title || x.name).filter(Boolean);
    return {
      id: "gcp-" + item.id, source: "Google Cloud Status",
      text: [item.external_desc || item.title || "Incidente publicado pelo Google Cloud", services.length ? "Serviços: " + services.join(", ") : "", updates.join(" — ")].filter(Boolean).join(" — ").slice(0, 1000),
      created_at: item.begin || item.created || null, lang: "en", author: "Status oficial do Google Cloud",
      url: item.uri ? (String(item.uri).startsWith("http") ? item.uri : "https://status.cloud.google.com" + item.uri) : "https://status.cloud.google.com/",
      kind: "official_status", impact: item.severity || "unknown",
      public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 }
    };
  });
  officialCache.set("google-cloud", { at: Date.now(), posts });
  return posts;
}
async function awsStatusFeed() {
  const cached = officialCache.get("aws-status");
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.posts;
  const xml = await fetchText("https://status.aws.amazon.com/rss/all.rss");
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const posts = blocks.map((block, i) => {
    const title = xmlTag(block, "title"), description = cleanHtml(xmlTag(block, "description"));
    const link = xmlTag(block, "link"), published = xmlTag(block, "pubDate");
    return { id: "aws-status-" + (link || i), source: "AWS Health Status",
      text: [title, description].filter(Boolean).join(" — ").slice(0, 1000),
      created_at: published ? new Date(published).toISOString() : null, lang: "en",
      author: "Status oficial da AWS", url: link || "https://health.aws.amazon.com/health/status",
      kind: "official_status", impact: "unknown",
      public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 } };
  }).filter(p => p.text && (!p.created_at || Date.parse(p.created_at) >= cutoff)).slice(0, 25);
  officialCache.set("aws-status", { at: Date.now(), posts });
  return posts;
}
async function gdeltNews() {
  if (gdeltCache.posts.length && Date.now() - gdeltCache.at < 15 * 60 * 1000) return gdeltCache.posts;
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", '(outage OR blackout OR "power failure" OR "internet disruption" OR "service disruption" OR "telecom outage" OR "cloud outage" OR "grid failure")');
  url.searchParams.set("mode", "ArtList"); url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "30"); url.searchParams.set("sort", "DateDesc");
  url.searchParams.set("timespan", "24h");
  const data = await fetchJson(url.toString());
  const posts = (data.articles || []).map(item => ({
    id: "gdelt-" + (item.url || item.url_mobile || item.title),
    source: "GDELT · Notícias globais",
    text: [item.title, item.domain ? "Veículo: " + item.domain : "", item.sourcecountry ? "País da fonte: " + item.sourcecountry : ""].filter(Boolean).join(" — "),
    created_at: item.seendate ? (item.seendate.length === 16 ? item.seendate.slice(0,4)+"-"+item.seendate.slice(4,6)+"-"+item.seendate.slice(6,8)+"T"+item.seendate.slice(9,11)+":"+item.seendate.slice(11,13)+":"+item.seendate.slice(13,15)+"Z" : null) : null,
    lang: item.language || "und", author: item.domain || "Veículo de notícias",
    url: item.url || item.url_mobile || "https://www.gdeltproject.org/", kind: "news_signal",
    public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 }
  })).filter(p => p.text && p.url);
  gdeltCache = { at: Date.now(), posts };
  return posts;
}
async function nwsAlerts() {
  if (nwsCache.posts.length && Date.now() - nwsCache.at < 3 * 60 * 1000) return nwsCache.posts;
  const response = await fetch("https://api.weather.gov/alerts/active?status=actual&limit=30", {
    headers: { "Accept": "application/geo+json", "User-Agent": "XPulsePublicMonitor/1.0 (public infrastructure awareness)" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("NWS Alerts HTTP " + response.status);
  const data = await response.json();
  const posts = (data.features || []).slice(0, 30).map(feature => {
    const p = feature.properties || {};
    return {
      id: "nws-" + (p.id || feature.id), source: "NWS · Alertas oficiais (EUA)",
      text: [p.event, p.areaDesc, p.severity ? "Severidade: " + p.severity : "", p.headline, p.description].filter(Boolean).join(" — ").slice(0, 1000),
      created_at: p.sent || p.effective || null, lang: "en", author: p.senderName || "National Weather Service",
      url: p.web || p["@id"] || "https://www.weather.gov/alerts", kind: "context_signal", context_type: "weather_alert",
      public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 }
    };
  }).filter(p => p.text);
  nwsCache = { at: Date.now(), posts };
  return posts;
}
async function usgsEarthquakes() {
  if (usgsCache.posts.length && Date.now() - usgsCache.at < 5 * 60 * 1000) return usgsCache.posts;
  const data = await fetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
  const posts = (data.features || []).map(feature => {
    const p = feature.properties || {}, coords = feature.geometry?.coordinates || [];
    return {
      id: "usgs-" + feature.id, source: "USGS · Terremotos globais",
      text: ["Terremoto magnitude " + p.mag, p.place, "Profundidade: " + (coords[2] ?? "n/d") + " km"].filter(Boolean).join(" — "),
      created_at: p.time ? new Date(p.time).toISOString() : null, lang: "en",
      author: "U.S. Geological Survey", url: p.url || "https://earthquake.usgs.gov/earthquakes/map/",
      kind: "context_signal", context_type: "earthquake",
      coordinates: coords.length >= 2 ? { lat: coords[1], lon: coords[0] } : null,
      public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0 }
    };
  });
  usgsCache = { at: Date.now(), posts };
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
  const isOfficial = post.kind === "official_status";
  const isContext = post.kind === "context_signal";
  const isNews = post.kind === "news_signal";
  let category = "infraestrutura";
  if (CYBER_WORDS.test(text)) category = "ciberseguranca";
  else if (DIGITAL_WORDS.test(text) && !POWER_WORDS.test(text)) category = "servicos_digitais";
  else if (POWER_WORDS.test(text)) category = "energia";
  else if (/internet|broadband|wifi|wi-fi|fiber|fibra|connectivity|conectividade|network|rede|telecom/i.test(text)) category = "conectividade";
  let status = "em_verificacao";
  let confidence = (isTechnical || isOfficial) ? "alta" : "baixa";
  if (isOfficial) { status = "sinal_tecnico"; confidence = "alta"; }
  else if (isContext) { status = "em_verificacao"; confidence = "media"; }
  else if (isNews && EVENT_WORDS.test(text)) { status = "em_verificacao"; confidence = "media"; }
  else if (NOISE_WORDS.test(text) && !EVENT_WORDS.test(text)) { status = "ruido"; confidence = "baixa"; }
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
  const candidates = posts.filter(p => p.classification !== "ruido" && p.kind !== "context_signal");
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
  const blueskyTerms = custom ? [custom] : ['"power outage"', '"internet outage"', '"blackout"', '"bank outage"', '"cloud outage"', '"service outage"', '"telecom outage"', '"cyber incident"', '"corte de luz"', '"caída de internet"', '"apagón"', '"panne internet"', '"stromausfall"', '"停電"', '"ネット障害"'];
  const mastodonTags = custom ? [] : ["poweroutage", "internetoutage", "blackout", "bankoutage", "cloudoutage", "serviceoutage", "telecomoutage", "cyberincident", "cortedeluz", "caidadeinternet", "apagón", "panneinternet", "stromausfall"];
  const redditTerms = custom ? [custom] : ['"power outage" OR "internet outage"', '"bank outage" OR "payment outage"', '"cloud outage" OR "service outage"', '"telecom outage" OR "mobile network down"', '"cyber incident" OR ransomware', "blackout", '"corte de luz" OR "caída de internet" OR apagón', '"panne internet" OR stromausfall', '"停電" OR "ネット障害"'];
  const sources = {
    Bluesky: { status: "consultando", count: 0 }, Mastodon: { status: "consultando", count: 0 },
    Reddit: { status: "consultando", count: 0 }, "GDELT · Notícias globais": { status: "consultando", count: 0 },
    "NWS · Alertas oficiais (EUA)": { status: "consultando", count: 0 },
    "USGS · Terremotos globais": { status: "consultando", count: 0 },
    "AWS Health Status": { status: "consultando", count: 0 }, "Google Cloud Status": { status: "consultando", count: 0 },
    "Cloudflare Status": { status: "consultando", count: 0 }, "GitHub Status": { status: "consultando", count: 0 },
    "Fastly Status": { status: "consultando", count: 0 }, "DigitalOcean Status": { status: "consultando", count: 0 },
    "Atlassian Status": { status: "consultando", count: 0 }, "OpenAI Status": { status: "consultando", count: 0 },
    "Discord Status": { status: "consultando", count: 0 }, "Zoom Status": { status: "consultando", count: 0 },
    "Stripe Status": { status: "consultando", count: 0 }, "Twilio Status": { status: "consultando", count: 0 },
    "npm Status": { status: "consultando", count: 0 }, "GitLab Status": { status: "consultando", count: 0 },
    "Cloudflare Radar": { status: CLOUDFLARE_API_TOKEN ? "consultando" : "aguardando token opcional", count: 0 },
    YouTube: { status: YOUTUBE_API_KEY ? "consultando" : "aguardando chave de API", count: 0 }
  };
  const jobs = [
    ...blueskyTerms.map(term => blueskySearch(term).then(posts => ({ source: "Bluesky", posts }))),
    ...mastodonTags.map(tag => mastodonTag(tag).then(posts => ({ source: "Mastodon", posts }))),
    ...redditTerms.map(term => redditSearch(term).then(posts => ({ source: "Reddit", posts }))),
    gdeltNews().then(posts => ({ source: "GDELT · Notícias globais", posts })),
    nwsAlerts().then(posts => ({ source: "NWS · Alertas oficiais (EUA)", posts })),
    usgsEarthquakes().then(posts => ({ source: "USGS · Terremotos globais", posts })),
    awsStatusFeed().then(posts => ({ source: "AWS Health Status", posts })),
    googleCloudIncidents().then(posts => ({ source: "Google Cloud Status", posts })),
    ...STATUS_PAGES.map(page => statusPageIncidents(page).then(posts => ({ source: page.name, posts }))),
    ...(YOUTUBE_API_KEY ? [youtubeSearch().then(posts => ({ source: "YouTube", posts }))] : []),
    ...(CLOUDFLARE_API_TOKEN ? [cloudflareOutages().then(posts => ({ source: "Cloudflare Radar", posts }))] : [])
  ];
  const settled = await Promise.allSettled(jobs), posts = [], errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      posts.push(...result.value.posts); sources[result.value.source].count += result.value.posts.length; sources[result.value.source].status = "ok";
    } else errors.push(result.reason?.message || "Falha na fonte");
  }
  for (const [name, source] of Object.entries(sources)) if (source.status === "consultando") source.status = "sem resultados ou indisponível";
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
    note: "Monitoramento global experimental com redes sociais públicas, notícias GDELT, páginas oficiais de status e alertas contextuais. YouTube e Cloudflare Radar exigem credenciais próprias. Alertas meteorológicos e terremotos são contexto, não confirmação de falha de serviço.",
    updated_at: new Date().toISOString() };
  cache = { key: cacheKey, at: Date.now(), value }; return value;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return send(res, 200, { ok: true, service: "X PULSE", sources: ["Bluesky", "Mastodon", "Reddit", "GDELT", "NWS", "USGS", "AWS", "Google Cloud", "Cloudflare Status", "GitHub Status", "Fastly", "DigitalOcean", "Atlassian", "OpenAI", "Discord", "Zoom", "Stripe", "Twilio", "npm", "GitLab", "YouTube", "Cloudflare Radar"] });
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
