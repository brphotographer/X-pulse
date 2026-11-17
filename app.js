const $ = (id) => document.getElementById(id);
let map, markers;
function initMap(){ if(!window.L)return; map=L.map("map",{worldCopyJump:true}).setView([-14,-52],4); L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{attribution:'&copy; OpenStreetMap &copy; CARTO',subdomains:"abcd",maxZoom:19}).addTo(map); markers=L.layerGroup().addTo(map); }
function fmt(n){return new Intl.NumberFormat("pt-BR").format(n||0)}
function time(){ $("clock").textContent=new Date().toISOString().slice(11,19)+" UTC"; }
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function addMapPosts(){if(!markers)return;markers.clearLayers();L.marker([-14,-52],{opacity:0}).addTo(markers).bindPopup("As redes consultadas não fornecem localização precisa e consistente para todos os relatos. O mapa não inventa localizações.");}
function render(posts){
  const likes=posts.reduce((n,p)=>n+(p.public_metrics?.like_count||0),0), reposts=posts.reduce((n,p)=>n+(p.public_metrics?.retweet_count||0),0);
  $("total").textContent=fmt(posts.length);$("likes").textContent=fmt(likes);$("reposts").textContent=fmt(reposts);$("count-tag").textContent=posts.length+" ITENS";
  $("feed").innerHTML=posts.length?posts.map(p=>'<article class="post"><div class="post-meta"><span>'+esc(p.source||"Rede social").toUpperCase()+' · '+esc(p.lang||"idioma n/d").toUpperCase()+'</span><span>'+esc(p.created_at?new Date(p.created_at).toLocaleString("pt-BR"):"")+'</span></div><p>'+esc(p.text)+'</p><div class="post-stats">'+esc(p.author||"Conta pública")+'　♡ '+fmt(p.public_metrics?.like_count)+'　↻ '+fmt(p.public_metrics?.retweet_count)+'　 Respostas '+fmt(p.public_metrics?.reply_count)+'</div>'+(p.url?'<a class="source-link" href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">Abrir publicação original ↗</a>':"")+'</article>').join(""):'<div class="empty">Nenhuma publicação encontrada nas fontes disponíveis. Tente outra busca ou atualize mais tarde.</div>';
  addMapPosts(posts);
}
async function load(){
  $("connection").textContent="CONSULTANDO FONTES PÚBLICAS";$("refresh").disabled=true;
  try{
    const q=$("query").value.trim();const r=await fetch("/api/posts"+(q?"?q="+encodeURIComponent(q):""));const data=await r.json();if(!r.ok)throw new Error(data.error||"Erro na consulta");
    render(data.posts||[]);$("mode").textContent="MULTIRREDE";
    const sourceSummary=Object.entries(data.sources||{}).map(([name,s])=>name+": "+(s.status==="ok"?s.count+" publicações":s.status)).join(" · ");
    $("mode-note").textContent=sourceSummary||data.note||"Fontes públicas";
    $("connection").textContent=data.warning?"FONTES PARCIALMENTE DISPONÍVEIS":"FONTES PÚBLICAS CONECTADAS";
    $("updated").textContent="Atualizado às "+new Date().toLocaleTimeString("pt-BR");
  }catch(e){$("connection").textContent="ERRO NA CONSULTA";$("feed").innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
  finally{$("refresh").disabled=false;}
}
function saveObservation(){const title=$("obs-title").value.trim(),body=$("obs-body").value.trim(),status=$("obs-status").value;if(!title||!body){alert("Preencha o título e a descrição.");return;}const el=document.createElement("article");el.className="observation";el.innerHTML='<strong>'+esc(title)+'</strong><span class="tag">'+esc(status.toUpperCase())+'</span><p>'+esc(body)+'</p><small>Registrado em '+new Date().toLocaleString("pt-BR")+'</small>';$("observations").querySelector(".empty")?.remove();$("observations").prepend(el);$("obs-title").value="";$("obs-body").value="";}
initMap();time();setInterval(time,1000);$("refresh").addEventListener("click",load);$("search").addEventListener("click",load);$("query").addEventListener("keydown",e=>{if(e.key==="Enter")load();});$("add-observation").addEventListener("click",saveObservation);load();setInterval(load,300000);
