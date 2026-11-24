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
  if(!activePerson || $("messages").querySelector('[data-message="'+m.id+'"]')) return;
  const node=document.createElement("div"); node.className="bubble "+(m.sender_id===me.id?"mine":""); node.dataset.message=m.id;
  if(m.message_type==="audio" && m.audio_base64){
    const audio=document.createElement("audio"); audio.controls=true; audio.preload="metadata"; audio.setAttribute("playsinline","");
    audio.src="data:"+(m.audio_mime||"audio/webm")+";base64,"+m.audio_base64; audio.className="voice-player"; node.append(audio);
    const caption=document.createElement("small"); caption.className="voice-caption"; caption.textContent="Голосовое сообщение"; node.append(caption);
  } else { node.append(document.createTextNode(m.body||"")); }
  const stamp=document.createElement("time"); stamp.textContent=time(m.created_at); node.append(stamp);
  $("messages").append(node); $("messages").scrollTop=$("messages").scrollHeight;
}
$("messageForm").addEventListener("submit",e=>{
  e.preventDefault(); if(!activePerson||!socket)return; const body=$("messageText").value.trim(); if(!body)return;
  socket.emit("message:send",{recipientId:activePerson.id,body},result=>{
    if(!result?.ok){toast(result?.error||"Не удалось отправить");return;}
    $("messageText").value="";
    if(result.message && !$("messages").querySelector('[data-message="'+result.message.id+'"]')) appendMessage(result.message);
  });
});

const emojiSets={
 recent:[],
 smile:["😀","😃","😄","😁","😆","🥹","😅","😂","🤣","🥲","☺️","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😜","🤪","😝","🤗","🤭","🫢","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫠","😏","😒","🙄","😬","😮‍💨","🤥","😔","🥺","😢","😭","😤","😠","😡","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤤","😴","🤧","🤒","🤕","😷","🤠","🥳","😎","🤓","🧐"],
 heart:["❤️","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","💔","❤️‍🔥","❤️‍🩹","💕","💞","💓","💗","💖","💘","💝","💟","❣️","💌","💋","💍","💐","🌷","🌸","🌺","🌻","🌼","🪷","✨","⭐","🌟","💫","🫶"],
 animal:["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐣","🐥","🐧","🦄","🦋","🐝","🐞","🐢","🐬","🦭","🐈","🐕"],
 food:["🍓","🍒","🍑","🍉","🍇","🍍","🥑","🍋","🍊","🍎","🍏","🫐","🥥","🍰","🎂","🧁","🍩","🍪","🍫","🍬","🍭","🍦","🍧","☕","🧋","🍵","🥐","🍕","🍣","🍜"],
 activity:["🎀","🎉","🎊","🎈","🎁","🎂","🎨","🎧","🎤","🎵","🎶","💃","🕺","🩰","⚽","🏀","🎮","🧸","🪩","🏖️","🌈","🪄"],
 object:["📱","💻","📷","🎥","💡","📚","✏️","🖊️","🧷","🪞","🕯️","🛍️","👑","💎","🔑","🗝️","🧿","🪬","☁️","🌙","☀️","⚡","🔥","💧","🌊"],
 kiko:["૮₍ ˶ᵔ ᵕ ᵔ˶ ₎ა","૮꒰ ˶• ༝ •˶꒱ა","꒰ა ♡ ໒꒱","ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧","(づ๑•ᴗ•๑)づ♡","૮ ˶ᵔ ᵕ ᵔ˶ ა","(｡•́‿•̀｡)","( ˶ˆᗜˆ˵ )","(˶˃ ᵕ ˂˶)","♡(˃͈ દ ˂͈ ༶ )","✿","୨୧","₊˚⊹♡","(๑ᵔ⤙ᵔ๑)","(╥﹏╥)","(¬‿¬)","(づ｡◕‿‿◕｡)づ","꒰ঌ(˶ˆᗜˆ˵)໒꒱","૮₍ ˶•⤙•˶ ₎ა","( ˘͈ ᵕ ˘͈♡)"]
};
let activeEmojiCategory="recent", recentEmojis=[];
try{recentEmojis=JSON.parse(localStorage.getItem("kiko_recent_emojis")||"[]").slice(0,24)}catch{}
function emojiArtwork(value){
 const faces={
  "😀":["M14 21 Q24 34 34 21","M15 15h.1 M33 15h.1"],
  "😃":["M12 20 Q24 38 36 20","M15 14 Q17 11 19 14 M29 14 Q31 11 33 14"],
  "😄":["M11 19 Q24 40 37 19","M14 13 Q17 9 20 13 M28 13 Q31 9 34 13"],
  "😁":["M11 19 Q24 38 37 19 L35 27 Q24 34 13 27Z","M14 13 Q17 10 20 13 M28 13 Q31 10 34 13"],
  "😆":["M11 18 Q24 40 37 18 L35 29 Q24 36 13 29Z","M13 14 Q17 9 21 14 M27 14 Q31 9 35 14"],
  "😂":["M12 20 Q24 35 36 20","M14 14h.1 M32 14h.1"],
  "🤣":["M11 20 Q24 37 37 20","M14 14h.1 M32 14h.1"],
  "🥰":["M13 15 Q17 10 21 15 M27 15 Q31 10 35 15","M16 25 Q24 33 32 25"],
  "😍":["M13 15 Q17 10 21 15 M27 15 Q31 10 35 15","M16 25 Q24 33 32 25"],
  "😘":["M14 15h.1 M32 15h.1","M19 25 Q25 29 31 23"],
  "😊":["M14 15h.1 M32 15h.1","M15 22 Q24 33 33 22"],
  "😎":["M10 16h14l-1 7h-11z M26 16h14l-2 7h-11z","M20 29 Q24 31 28 29"],
  "🥳":["M14 15h.1 M32 15h.1","M15 22 Q24 34 33 22"],
  "😢":["M14 15h.1 M32 15h.1","M18 29 Q24 23 30 29"],
  "😭":["M14 15h.1 M32 15h.1","M17 29 Q24 21 31 29"],
  "😡":["M13 16l7 2 M35 16l-7 2","M17 30 Q24 24 31 30"],
  "😱":["M14 14h.1 M32 14h.1","M20 23 Q24 35 28 23Z"],
  "🥺":["M14 16h.1 M32 16h.1","M19 29 Q24 26 29 29"]
 };
 const f=faces[value]; if(!f)return null;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><radialGradient id="g" cx="32%" cy="22%" r="76%"><stop stop-color="#fff9c9"/><stop offset=".35" stop-color="#ffe36a"/><stop offset=".78" stop-color="#ffb91f"/><stop offset="1" stop-color="#e88908"/></radialGradient><linearGradient id="s" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".72"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="d" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="1.6"/></filter></defs><ellipse cx="25" cy="44" rx="15" ry="2.5" fill="#9b641b" opacity=".2" filter="url(#d)"/><circle cx="24" cy="23" r="20" fill="#d88712" opacity=".28"/><circle cx="24" cy="22" r="19" fill="url(#g)" stroke="#e69a17" stroke-width=".7"/><ellipse cx="17" cy="10" rx="12" ry="5" fill="url(#s)" opacity=".8"/><path d="'+f[0]+'" stroke="#633b20" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="'+f[1]+'" stroke="#633b20" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><ellipse cx="13" cy="25" rx="3.5" ry="2" fill="#f27b58" opacity=".35"/><ellipse cx="35" cy="25" rx="3.5" ry="2" fill="#f27b58" opacity=".35"/></svg>';
 return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
}
function renderEmojiGrid(){
 const grid=$("emojiGrid"), query=$("emojiSearch").value.trim().toLowerCase();
 grid.innerHTML="";
 let values=activeEmojiCategory==="recent"?recentEmojis:emojiSets[activeEmojiCategory]||[];
 if(query) values=Object.values(emojiSets).flat().filter(v=>v.toLowerCase().includes(query));
 if(!values.length){grid.innerHTML='<div class="emoji-empty">Найди свой смайл ✿</div>';return;}
 values.forEach(value=>{
  const btn=document.createElement("button");btn.type="button";btn.className="emoji-cell";btn.title=value;const artwork=emojiArtwork(value);if(artwork){const img=document.createElement("img");img.className="emoji-artwork";img.src=artwork;img.alt=value;btn.append(img);}else{btn.textContent=value;}btn.addEventListener("click",()=>insertEmoji(value));grid.append(btn);
 });
}
function insertEmoji(value){
 const input=$("messageText"),start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
 input.value=input.value.slice(0,start)+value+input.value.slice(end);
 input.focus();const cursor=start+value.length;input.setSelectionRange(cursor,cursor);
 recentEmojis=[value,...recentEmojis.filter(x=>x!==value)].slice(0,24);
 try{localStorage.setItem("kiko_recent_emojis",JSON.stringify(recentEmojis))}catch{}
 $("emojiPanel").classList.add("hidden");
}
$("emojiToggle").addEventListener("click",()=>{
 const panel=$("emojiPanel"),opening=panel.classList.contains("hidden");
 panel.classList.toggle("hidden");if(opening){$("emojiSearch").value="";activeEmojiCategory="recent";$("emojiTabs").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b.dataset.category==="recent"));renderEmojiGrid();}
});
$("emojiClose").addEventListener("click",()=>$("emojiPanel").classList.add("hidden"));
$("emojiTabs").addEventListener("click",e=>{
 const btn=e.target.closest("button[data-category]");if(!btn)return;
 activeEmojiCategory=btn.dataset.category;$("emojiSearch").value="";
 $("emojiTabs").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b===btn));renderEmojiGrid();
});
$("emojiSearch").addEventListener("input",()=>renderEmojiGrid());
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("emojiPanel").classList.add("hidden")});
renderEmojiGrid();
let recorder=null, recordingChunks=[];
$("recordButton").addEventListener("click",async()=>{
  const button=$("recordButton");
  if(recorder && recorder.state==="recording"){recorder.stop();button.textContent="🎙";button.classList.remove("recording");return;}
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){toast("Запись аудио не поддерживается этим браузером");return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const isApple=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
    const formats=isApple?["audio/mp4","audio/mp4;codecs=mp4a.40.2","audio/webm;codecs=opus","audio/webm"]:["audio/webm;codecs=opus","audio/webm","audio/mp4"];
    const mime=formats.find(t=>MediaRecorder.isTypeSupported(t));
    recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});
    recordingChunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data);};
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(recordingChunks,{type:recorder.mimeType||"audio/webm"});
      if(blob.size>5*1024*1024){toast("Голосовое слишком длинное (максимум 5 МБ)");return;}
      if(!activePerson||!socket){toast("Сначала открой личный чат");return;}
      button.disabled=true;toast("Отправляем голосовое…");
      try{
        const base64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(blob);
        });
        socket.emit("message:send",{recipientId:activePerson.id,audio_base64:base64,audio_mime:blob.type},result=>{
          button.disabled=false;
          if(!result?.ok){toast(result?.error||"Не удалось отправить голосовое");return;}
          if(result.message)appendMessage(result.message);
        });
      }catch(err){button.disabled=false;toast("Не удалось подготовить аудио");}
    };
    recorder.start();button.textContent="■";button.classList.add("recording");toast("Идёт запись. Нажми ■, чтобы отправить");
  }catch(err){toast("Разреши доступ к микрофону для записи");}
});
boot();