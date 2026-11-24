const $ = id => document.getElementById(id);
let token = localStorage.getItem("kiko_token");
let me = null, socket = null, authMode = "login", activePerson = null, knownPeople = [];
const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401) logout(); throw new Error(data.error || "Что-то пошло не так"); }
  return data;
};
function toast(message) { $("toast").textContent = message; $("toast").classList.add("show"); setTimeout(() => $("toast").classList.remove("show"), 2400); }
function initials(name) { return (name || "?").slice(0,1).toUpperCase(); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function time(value) { return new Date(value).toLocaleString("ru-RU", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }); }
function logout() { localStorage.removeItem("kiko_token"); token = null; me = null; if(socket) socket.disconnect(); $("appView").classList.add("hidden"); $("authView").classList.remove("hidden"); }
function showApp() {
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("myName").textContent = me.username; $("myAvatar").textContent = initials(me.username); $("postAvatar").textContent = initials(me.username);
  socket = io({ auth: { token } });
  socket.on("message:new", message => { if (activePerson && (message.sender_id === activePerson.id || message.recipient_id === activePerson.id)) appendMessage(message); });
  socket.on("post:new", post => { if (!$("feed").querySelector('[data-id="' + post.id + '"]')) renderPost(post, true); });
  socket.on("post:like", data => { const card = $("feed").querySelector('[data-id="' + data.postId + '"]'); if(card){ const btn=card.querySelector(".like-btn"); btn.textContent = (data.liked && data.userId===me.id ? "♥ " : "♡ ") + data.likes; if(data.userId===me.id) btn.classList.toggle("liked",data.liked); } });
  loadFeed();
}
async function boot() { if (!token) return; try { const data = await api("/api/me"); me = data.user; showApp(); } catch { logout(); } }
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  authMode = btn.dataset.mode; document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b===btn));
  $("authSubmit").textContent = authMode === "login" ? "Войти" : "Создать аккаунт";
}));
$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); $("authError").textContent = "";
  try {
    const data = await api("/api/auth/" + authMode, { method:"POST", body:JSON.stringify({ username:$("username").value, password:$("password").value }) });
    token = data.token; me = data.user; localStorage.setItem("kiko_token", token); showApp();
  } catch(err) { $("authError").textContent = err.message; }
});
$("logout").onclick = logout;
async function loadFeed() { try { const posts = await api("/api/posts"); $("feed").innerHTML = ""; if(!posts.length) $("feed").innerHTML='<div class="empty">Здесь пока тихо. Напиши первым ✿</div>'; posts.forEach(p => renderPost(p)); } catch(e){toast(e.message);} }
function renderPost(p, prepend=false) {
  const empty = $("feed").querySelector(".empty"); if(empty) empty.remove();
  const card = document.createElement("article"); card.className="post"; card.dataset.id=p.id;
  card.innerHTML='<div class="post-head"><div class="my-avatar">'+escapeHtml(initials(p.username))+'</div><div><div class="post-author">'+escapeHtml(p.username)+'</div><div class="post-time">'+time(p.created_at)+'</div></div></div><div class="post-body">'+escapeHtml(p.body)+'</div><button class="like-btn '+(p.liked?'liked':'')+'">'+(p.liked?'♥':'♡')+' '+(p.likes||0)+'</button>';
  card.querySelector(".like-btn").onclick = async () => { try { const d=await api("/api/posts/"+p.id+"/like",{method:"POST"}); const b=card.querySelector(".like-btn"); b.textContent=(d.liked?"♥ ":"♡ ")+d.likes; b.classList.toggle("liked",d.liked); } catch(e){toast(e.message);} };
  prepend ? $("feed").prepend(card) : $("feed").append(card);
}
$("postForm").addEventListener("submit", async e => { e.preventDefault(); const body=$("postText").value.trim(); if(!body)return; try { const p=await api("/api/posts",{method:"POST",body:JSON.stringify({body})}); if(!$("feed").querySelector('[data-id="'+p.id+'"]')) renderPost(p,true); $("postText").value=""; } catch(e){toast(e.message);} });
document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => {
  const chats=btn.dataset.view==="chats"; document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b===btn));
  $("wallView").classList.toggle("hidden",chats); $("chatsView").classList.toggle("hidden",!chats);
  $("pageTitle").textContent=chats?"Личные чаты":"Общая стена"; if(chats) loadPeople();
});
async function loadPeople(q="") {
  try { knownPeople=await api("/api/users?q="+encodeURIComponent(q)); renderPeople(); } catch(e){toast(e.message);}
}
function renderPeople() {
  $("peopleList").innerHTML="";
  if(!knownPeople.length){$("peopleList").innerHTML='<div class="empty">Пока никого нет</div>';return;}
  knownPeople.forEach(person=>{
    const item=document.createElement("div"); item.className="person "+(activePerson?.id===person.id?"active":"");
    item.innerHTML='<div class="my-avatar">'+escapeHtml(initials(person.username))+'</div><div><b>'+escapeHtml(person.username)+'</b><small>Личный чат</small></div>';
    item.onclick=()=>openChat(person); $("peopleList").append(item);
  });
}
$("userSearch").addEventListener("input",e=>loadPeople(e.target.value));
async function openChat(person) {
  activePerson=person; renderPeople(); $("chatLayout").classList.add("mobile-chat-open"); $("chatPlaceholder").classList.add("hidden"); $("chatActive").classList.remove("hidden");
  $("chatName").textContent=person.username; $("chatAvatar").textContent=initials(person.username); $("messages").innerHTML="";
  try { const list=await api("/api/messages/"+person.id); list.forEach(appendMessage); } catch(e){toast(e.message);}
}
function appendMessage(m) {
  if(!activePerson) return;
  const node=document.createElement("div"); node.className="bubble "+(m.sender_id===me.id?"mine":""); node.dataset.message=m.id;
  node.innerHTML=escapeHtml(m.body)+'<time>'+time(m.created_at)+'</time>'; $("messages").append(node); $("messages").scrollTop=$("messages").scrollHeight;
}
$("messageForm").addEventListener("submit",e=>{
  e.preventDefault(); if(!activePerson||!socket)return; const body=$("messageText").value.trim(); if(!body)return;
  socket.emit("message:send",{recipientId:activePerson.id,body},result=>{
    if(!result?.ok){toast(result?.error||"Не удалось отправить");return;}
    $("messageText").value="";
    if(result.message && !$("messages").querySelector('[data-message="'+result.message.id+'"]')) appendMessage(result.message);
  });
});
boot();