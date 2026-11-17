const $ = (id) => document.getElementById(id);
let map, markers, allPosts = [], allIncidents = [], activeFilter = "todos";
const labels = { em_verificacao:"Em verificação", sinal_tecnico:"Sinal técnico", programado:"Programado", rumor:"Rumor / não confirmado", ruido:"Fora do escopo" };
const categories = { energia:"Energia", conectividade:"Conectividade", servicos_digitais:"Serviços digitais", ciberseguranca:"Cibersegurança", infraestrutura:"Infraestrutura" };
function initMap(){
  if(!window.L)return;
  map=L.map("map",{worldCopyJump:true,zoomControl:true}).setView([20,0],2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{attribution:'&copy; OpenStreetMap &copy; CARTO',subdomains:"abcd",maxZoom:19}).addTo(map);
  markers=L.layerGroup().addTo(map);
  const radar=$("radar-overlay");
  if(radar) $("map").appendChild(radar);
  const toggle=$("radar-toggle");
  if(toggle) toggle.addEventListener("click",()=>{
    const paused=radar?.classList.toggle("is-paused")||false;
    toggle.setAttribute("aria-pressed",String(!paused));
    toggle.textContent=paused?"▶ ATIVAR RADAR":"Ⅱ PAUSAR RADAR";
    $("radar-state").textContent=paused?"RADAR PAUSADO":"RADAR ATIVO";
  });
}
function fmt(n){return new Intl.NumberFormat("pt-BR").format(n||0)}
function time(){ $("clock").textContent=new Date().toISOString().slice(11,19)+" UTC"; }
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function badge(status){return '<span class="classification '+esc(status)+'">'+esc(labels[status]||status)+'</span>';}
function addMapPosts(){if(!markers)return;markers.clearLayers();L.marker([-14,-52],{opacity:0}).addTo(markers).bindPopup("O mapa não atribui coordenadas por inferência. A localização só será exibida quando vier estruturada de uma fonte confiável.");}
function renderSourceStatus(sources={}){
  const el=$("source-status"); if(!el)return;
  const entries=Object.entries(sources);
  const ok=entries.filter(([,s])=>s.status==="ok").length;
  el.innerHTML='<div class="source-status-head"><strong>'+ok+' / '+entries.length+' fontes consultadas com sucesso</strong><span>Atualização automática</span></div><div class="source-chips">'+entries.map(([name,s])=>{
    const state=s.status==="ok"?"online":s.status==="aguardando token opcional"||s.status==="aguardando chave de API"?"optional":"offline";
    const detail=s.status==="ok"?(s.count+' sinais'):s.status;
    return '<span class="source-chip '+state+'" title="'+esc(detail)+'"><i></i>'+esc(name)+'</span>';
  }).join("")+'</div>';
}
function render(posts, incidents=allIncidents){
  allPosts=posts; allIncidents=incidents;
  const visible=activeFilter==="todos"?posts:posts.filter(p=>p.classification===activeFilter);
  const likes=posts.reduce((n,p)=>n+(p.public_metrics?.like_count||0),0), reposts=posts.reduce((n,p)=>n+(p.public_metrics?.retweet_count||0),0);
  $("total").textContent=fmt(posts.length);$("likes").textContent=fmt(likes);$("reposts").textContent=fmt(reposts);$("count-tag").textContent=visible.length+" ITENS";
  $("feed").innerHTML=visible.length?visible.map(p=>'<article class="post"><div class="post-meta"><span>'+esc(p.source||"Rede social").toUpperCase()+' · '+esc(p.lang||"idioma n/d").toUpperCase()+'</span><span>'+esc(p.created_at?new Date(p.created_at).toLocaleString("pt-BR"):"")+'</span></div><div class="classification-row">'+badge(p.classification)+' <span class="category">'+esc(categories[p.category]||p.category||"")+'</span><span class="confidence">Confiança heurística: '+esc(p.confidence||"baixa")+'</span></div><p>'+esc(p.text)+'</p><div class="post-stats">'+esc(p.author||"Conta pública")+'　♡ '+fmt(p.public_metrics?.like_count)+'　↻ '+fmt(p.public_metrics?.retweet_count)+'　 Respostas '+fmt(p.public_metrics?.reply_count)+'</div>'+(p.url?'<a class="source-link" href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">Abrir publicação original ↗</a>':"")+'</article>').join(""):'<div class="empty">Nenhuma publicação nesta classificação.</div>';
  const active=posts.filter(p=>p.classification!=="ruido");
  $("incident-count").textContent=fmt(incidents.length);
  const shownIncidents=incidents.filter(g=>activeFilter==="todos"||g.posts?.some(p=>p.classification===activeFilter));
  $("incidents").innerHTML=shownIncidents.length?shownIncidents.slice(0,12).map(g=>'<article class="incident-item"><div class="incident-head"><strong>'+esc(categories[g.category]||g.category||"Incidente")+'</strong>'+badge(g.classification)+'</div><p>'+esc(g.title||"Relato agrupado")+'</p><small>'+fmt(g.post_count)+' publicações · '+esc((g.sources||[]).join(", "))+' · '+esc(g.latest_at?new Date(g.latest_at).toLocaleString("pt-BR"):"")+'</small></article>').join(""):'<div class="empty">Nenhum grupo de incidentes nesta consulta.</div>';
  addMapPosts();
}
async function load(){
  $("connection").textContent="CONSULTANDO FONTES PÚBLICAS";$("refresh").disabled=true;
  try{
    const q=$("query").value.trim();const r=await fetch("/api/posts"+(q?"?q="+encodeURIComponent(q):""));const data=await r.json();if(!r.ok)throw new Error(data.error||"Erro na consulta");
    renderSourceStatus(data.sources||{});render(data.posts||[],data.incidents||[]);$("mode").textContent="MULTIRREDE";
    const sourceSummary=Object.entries(data.sources||{}).map(([name,s])=>name+": "+(s.status==="ok"?s.count+" publicações":s.status)).join(" · ");
    $("mode-note").textContent=sourceSummary||data.note||"Fontes públicas";
    $("connection").textContent=data.warning?"FONTES PARCIALMENTE DISPONÍVEIS":"FONTES PÚBLICAS CONECTADAS";
    $("updated").textContent="Atualizado às "+new Date().toLocaleTimeString("pt-BR");
  }catch(e){$("connection").textContent="ERRO NA CONSULTA";$("feed").innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
  finally{$("refresh").disabled=false;}
}
function saveObservation(){const title=$("obs-title").value.trim(),body=$("obs-body").value.trim(),status=$("obs-status").value;if(!title||!body){alert("Preencha o título e a descrição.");return;}const el=document.createElement("article");el.className="observation";el.innerHTML='<strong>'+esc(title)+'</strong><span class="tag">'+esc(status.toUpperCase())+'</span><p>'+esc(body)+'</p><small>Registrado em '+new Date().toLocaleString("pt-BR")+'</small>';$("observations").querySelector(".empty")?.remove();$("observations").prepend(el);$("obs-title").value="";$("obs-body").value="";}
initMap();time();setInterval(time,1000);$("refresh").addEventListener("click",load);$("search").addEventListener("click",load);$("query").addEventListener("keydown",e=>{if(e.key==="Enter")load();});$("add-observation").addEventListener("click",saveObservation);
$("classification-filter").addEventListener("change",e=>{activeFilter=e.target.value;render(allPosts,allIncidents);});load();setInterval(load,300000);
