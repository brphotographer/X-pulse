const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon" };

const demoPosts = [
  { id:"demo-1", text:"Relato ilustrativo: moradores informam interrupção de energia em parte da região central. Aguardando confirmação.", created_at:new Date().toISOString(), lang:"pt", public_metrics:{like_count:4, retweet_count:2, reply_count:1}, demo:true },
  { id:"demo-2", text:"Relato ilustrativo: usuários mencionam lentidão e instabilidade no acesso à internet. Informação não verificada.", created_at:new Date(Date.now()-60000).toISOString(), lang:"pt", public_metrics:{like_count:7, retweet_count:3, reply_count:2}, demo:true },
  { id:"demo-3", text:"Exemplo de observação para acompanhamento de possível falha de infraestrutura. Não representa uma ocorrência real.", created_at:new Date(Date.now()-120000).toISOString(), lang:"en", public_metrics:{like_count:2, retweet_count:1, reply_count:0}, demo:true }
];

function send(res, status, data, type="application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

async function getPosts(term) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return { mode:"demo", warning:"Modo demonstração: configure X_BEARER_TOKEN para consultar dados reais.", posts:demoPosts };

  const query = (term || '(("queda de energia" OR apagão OR "sem luz" OR "sem internet" OR "internet caiu" OR instabilidade OR outage) -is:retweet)').slice(0, 450);
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "50");
  url.searchParams.set("tweet.fields", "created_at,lang,public_metrics,geo");
  url.searchParams.set("expansions", "geo.place_id");
  url.searchParams.set("place.fields", "full_name,country,geo,place_type");
  const response = await fetch(url, { headers:{ Authorization:"Bearer " + token } });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.detail || payload.title || "Falha ao consultar a API do X");
    error.status = response.status;
    throw error;
  }
  const places = Object.fromEntries((payload.includes?.places || []).map(p => [p.id, p]));
  const posts = (payload.data || []).map(p => {
    const place = p.geo?.place_id ? places[p.geo.place_id] : null;
    const coordinates = place?.geo?.bbox;
    return { ...p, place: place?.full_name || null, country: place?.country || null, coordinates: coordinates || null };
  });
  return { mode:"live", posts, result_count:posts.length, note:"A API do X retorna apenas dados públicos disponíveis para sua conta e plano." };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return send(res, 200, { ok:true, service:"X PULSE" });
  if (url.pathname === "/api/posts") {
    try { return send(res, 200, await getPosts(url.searchParams.get("q"))); }
    catch (e) { return send(res, e.status || 502, { error:e.message }); }
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