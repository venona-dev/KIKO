const $ = id => document.getElementById(id);
let token = localStorage.getItem("kiko_token");
let me = null, socket = null, authMode = "login", activePerson = null, knownPeople = [];
let peerConnection=null, localCallStream=null, remoteCallStream=null, callPeer=null, callMode="audio", incomingOffer=null, queuedIce=[], callId=null, callHistoryStarted=false, callInitiatorId=null;
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
function logout() { finishCall(false); localStorage.removeItem("kiko_token"); token = null; me = null; if(socket) socket.disconnect(); $("appView").classList.add("hidden"); $("authView").classList.remove("hidden"); }
async function loadProfile(){
 try{const p=await api("/api/profile");me={...me,...p};$("profileName").textContent=me.username;$("profileStatus").value=me.status||"";$("profileStatusPreview").textContent=me.status||"Настрой свой профиль";$("themeChoice").value=me.theme||"light";$("accentChoice").value=me.accent||"pink";$("wallpaperChoice").value=me.wallpaper||"soft";paintProfileAvatar();applyAppearance();document.dispatchEvent(new Event("kiko:avatar-painted"));}catch(e){toast(e.message);}
}
function paintProfileAvatar(){
 [$("myAvatar"),$("postAvatar"),$("profileAvatarPreview")].forEach(el=>{if(!el)return;el.textContent=me.avatar_data?"":initials(me.username);el.style.backgroundImage=me.avatar_data?'url("'+me.avatar_data+'")':"";el.classList.toggle("has-photo",!!me.avatar_data);});
}
function applyAppearance(){
 const colors={pink:"#d66f98",violet:"#9275d8",blue:"#5b9bd5",mint:"#48a98e",orange:"#e69a69"};
 document.documentElement.style.setProperty("--accent",colors[me.accent]||colors.pink);
 document.body.dataset.theme=me.theme||"light";document.body.dataset.wallpaper=me.wallpaper||"soft";
 const preview=$("themePreview");if(preview){preview.dataset.theme=me.theme||"light";preview.dataset.wallpaper=me.wallpaper||"soft";preview.style.setProperty("--accent",colors[me.accent]||colors.pink);}
}
$("saveProfile").onclick=async()=>{
 const file=$("avatarFile").files[0];let avatar_data=me.avatar_data||null;
 if(file){if(file.size>1500000){toast("Аватарка должна быть меньше 1,5 МБ");return;}avatar_data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);});}
 try{const p=await api("/api/profile",{method:"PUT",body:JSON.stringify({status:$("profileStatus").value,avatar_data})});me={...me,...p};$("avatarFile").value="";paintProfileAvatar();document.dispatchEvent(new Event("kiko:avatar-painted"));$("profileStatusPreview").textContent=me.status||"Настрой свой профиль";toast("Профиль сохранён");}catch(e){toast(e.message);}
};
$("saveAppearance").onclick=async()=>{
 try{const p=await api("/api/profile",{method:"PUT",body:JSON.stringify({theme:$("themeChoice").value,accent:$("accentChoice").value,wallpaper:$("wallpaperChoice").value})});me={...me,...p};applyAppearance();toast("Оформление применено");}catch(e){toast(e.message);}
};
["themeChoice","accentChoice","wallpaperChoice"].forEach(id=>$(id).addEventListener("change",()=>{const old=me;me={...me,theme:$("themeChoice").value,accent:$("accentChoice").value,wallpaper:$("wallpaperChoice").value};applyAppearance();me=old;}));

function showApp() {
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("myName").textContent = me.username; paintProfileAvatar(); applyAppearance();
  socket = io({ auth: { token } });
  socket.on("connect_error", err => toast("Связь с сервером прервана. Переподключаемся…"));
  socket.on("call:signal", handleCallSignal);
  socket.on("call:history:update", renderCallHistory);
  socket.on("message:new", message => { if (activePerson && (message.sender_id === activePerson.id || message.recipient_id === activePerson.id)) appendMessage(message); });
  socket.on("message:reaction", data => updateMessageReactions(data));
  socket.on("post:comment", comment => receivePostComment(comment));
  socket.on("post:new", post => { if (!$("feed").querySelector('[data-id="' + post.id + '"]')) renderPost(post, true); });
  socket.on("post:like", data => { const card = $("feed").querySelector('[data-id="' + data.postId + '"]'); if(card){ const btn=card.querySelector(".like-btn"); btn.textContent = (data.liked && data.userId===me.id ? "♥ " : "♡ ") + data.likes; if(data.userId===me.id) btn.classList.toggle("liked",data.liked); } });
  loadFeed();
  loadPeople("");
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
  card.innerHTML='<div class="post-head"><div class="my-avatar">'+escapeHtml(initials(p.username))+'</div><div><div class="post-author">'+escapeHtml(p.username)+'</div><div class="post-time">'+time(p.created_at)+'</div></div></div><div class="post-body">'+escapeHtml(p.body)+'</div><div class="post-actions"><button class="like-btn '+(p.liked?'liked':'')+'">'+(p.liked?'♥':'♡')+' '+(p.likes||0)+'</button><button class="comments-toggle" type="button">💬 Комментарии <span class="comments-count">'+(p.comments_count||0)+'</span></button></div><section class="post-comments hidden"><div class="comments-list"></div><form class="comment-form"><input maxlength="1000" placeholder="Написать комментарий…" required><button class="primary" type="submit">Отправить</button></form></section>';
  card.querySelector(".like-btn").onclick = async () => { try { const d=await api("/api/posts/"+p.id+"/like",{method:"POST"}); const b=card.querySelector(".like-btn"); b.textContent=(d.liked?"♥ ":"♡ ")+d.likes; b.classList.toggle("liked",d.liked); if(d.liked)window.kikoAchievementTrack?.("post_liked"); } catch(e){toast(e.message);} };
  const panel=card.querySelector(".post-comments"),list=card.querySelector(".comments-list"),toggle=card.querySelector(".comments-toggle");
  toggle.onclick=async()=>{const opening=panel.classList.contains("hidden");panel.classList.toggle("hidden");if(opening)await loadPostComments(p.id,list);};
  card.querySelector(".comment-form").onsubmit=async e=>{e.preventDefault();const input=e.currentTarget.querySelector("input"),body=input.value.trim();if(!body)return;const button=e.currentTarget.querySelector("button");button.disabled=true;try{const comment=await api("/api/posts/"+p.id+"/comments",{method:"POST",body:JSON.stringify({body})});renderPostComment(comment,list);updatePostCommentCount(p.id,1);input.value="";window.kikoAchievementTrack?.("comment_created");}catch(err){toast(err.message);}finally{button.disabled=false;}};
  prepend ? $("feed").prepend(card) : $("feed").append(card);
}
async function loadPostComments(postId,list){
  try{const rows=await api("/api/posts/"+postId+"/comments");list.innerHTML="";rows.forEach(comment=>renderPostComment(comment,list));}
  catch(e){toast(e.message);}
}
function renderPostComment(comment,list){
  if(!list||list.querySelector('[data-comment="'+comment.id+'"]'))return;
  const item=document.createElement("article");item.className="post-comment";item.dataset.comment=comment.id;
  item.innerHTML='<b>'+escapeHtml(comment.username)+'</b><p>'+escapeHtml(comment.body)+'</p><time>'+escapeHtml(time(comment.created_at))+'</time>';
  list.append(item);
}
function updatePostCommentCount(postId,delta){
  const card=$("feed").querySelector('[data-id="'+postId+'"]');if(!card)return;
  const count=card.querySelector(".comments-count");if(count)count.textContent=String(Math.max(0,Number(count.textContent||0)+delta));
}
function receivePostComment(comment){
  const card=$("feed").querySelector('[data-id="'+comment.post_id+'"]');if(!card)return;
  const count=card.querySelector(".comments-count");if(count&&me.id!==comment.user_id)updatePostCommentCount(comment.post_id,1);
  const panel=card.querySelector(".post-comments"),list=card.querySelector(".comments-list");
  if(!panel?.classList.contains("hidden"))renderPostComment(comment,list);
}
$("postForm").addEventListener("submit", async e => { e.preventDefault(); const body=$("postText").value.trim(); if(!body)return; try { const p=await api("/api/posts",{method:"POST",body:JSON.stringify({body})}); if(!$("feed").querySelector('[data-id="'+p.id+'"]')) renderPost(p,true); $("postText").value="";window.kikoAchievementTrack?.("post_created"); } catch(e){toast(e.message);} });
document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => {
  const chats=btn.dataset.view==="chats"; document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b===btn));
  $("wallView").classList.toggle("hidden",chats); $("chatsView").classList.toggle("hidden",!chats);
  const account=btn.dataset.view==="account"; $("wallView").classList.toggle("hidden",chats||account); $("chatsView").classList.toggle("hidden",!chats); $("accountView").classList.toggle("hidden",!account); $("pageTitle").textContent=account?"Профиль":chats?"Личные чаты":"Общая стена"; if(chats) loadPeople(); if(account) loadProfile();
});
let chatHistory = [];
async function loadPeople(q="") {
  const query=String(q||"").trim();
  try {
    if(query.length<2){knownPeople=[];chatHistory=await api("/api/chats");}
    else {const results=await Promise.all([api("/api/chats"),api("/api/users?q="+encodeURIComponent(query))]);chatHistory=results[0];knownPeople=results[1];}
    renderPeople(query);
  } catch(e){toast(e.message);}
}
function renderPeople(query="") {
  const root=$("peopleList");root.innerHTML="";
  const addHeading=(label)=>{const h=document.createElement("div");h.className="people-section-title";h.textContent=label;root.append(h);};
  const addPerson=(person,subtitle)=>{
    const item=document.createElement("div");item.className="person "+(activePerson?.id===person.id?"active":"");
    item.innerHTML='<div class="my-avatar">'+escapeHtml(initials(person.username))+'</div><div><b>'+escapeHtml(person.username)+'</b><small>'+escapeHtml(subtitle)+'</small></div>';
    item.onclick=()=>openChat(person);root.append(item);
  };
  if(chatHistory.length){addHeading("ТВОИ ДИАЛОГИ");chatHistory.forEach(p=>addPerson(p,p.last_message||"Личный чат"));}
  if(query.length>=2){addHeading("РЕЗУЛЬТАТЫ ПОИСКА");const historyIds=new Set(chatHistory.map(p=>String(p.id)));const matches=knownPeople.filter(p=>!historyIds.has(String(p.id)));if(!matches.length&&!chatHistory.some(p=>p.username.toLowerCase().includes(query.toLowerCase()))){const e=document.createElement("div");e.className="empty";e.textContent="Ничего не найдено. Попробуй другое имя";root.append(e);}matches.forEach(p=>addPerson(p,"Найти пользователя"));}
  else if(!chatHistory.length){const e=document.createElement("div");e.className="empty";e.textContent="Здесь появятся твои прежние диалоги. Чтобы начать новый, найди человека по имени";root.append(e);}
}
$("userSearch").addEventListener("input",e=>loadPeople(e.target.value));

document.querySelectorAll(".panel-tab").forEach(btn=>btn.addEventListener("click",()=>{
  const view=btn.dataset.view;
  $("chatsView").classList.add("hidden");$("wallView").classList.toggle("hidden",view!=="wall");$("accountView").classList.toggle("hidden",view!=="account");
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active",n.dataset.view===view));
  $("pageTitle").textContent=view==="account"?"Профиль":"Общая стена";
  if(view==="account")loadProfile();
}));
async function openChat(person) {
  activePerson=person; renderPeople(); $("chatLayout").classList.add("mobile-chat-open"); $("chatPlaceholder").classList.add("hidden"); $("chatActive").classList.remove("hidden");
  $("chatName").textContent=person.username; $("chatAvatar").textContent=initials(person.username); $("messages").innerHTML="";
  await syncMessages();
  await syncCallHistory();
}
async function syncMessages(){
  if(!activePerson || !token)return;
  const personId=activePerson.id;
  try { const list=await api("/api/messages/"+personId); if(activePerson?.id!==personId)return; list.forEach(appendMessage); }
  catch(e){ if(e.message!=="Не авторизован") console.warn("Message sync failed",e); }
}
async function syncCallHistory(){
  if(!activePerson||!token)return;
  const personId=activePerson.id;
  try{const rows=await api("/api/calls/"+personId);if(activePerson?.id!==personId)return;rows.forEach(renderCallHistory);}
  catch(e){if(e.message!=="Не авторизован")console.warn("Call history sync failed",e);}
}
setInterval(()=>{syncMessages();syncCallHistory();},4000);
function appendMessage(m) {
  if(!activePerson || $("messages").querySelector('[data-message="'+m.id+'"]')) return;
  const messageBox=$("messages"); const stickToBottom=!messageBox.children.length || messageBox.scrollHeight-messageBox.scrollTop-messageBox.clientHeight<80;
  const node=document.createElement("div"); node.className="bubble "+(m.sender_id===me.id?"mine":""); node.dataset.message=m.id; node.dataset.messageType=m.message_type||"text";
  if(m.reply_body){const quote=document.createElement("div");quote.className="reply-preview";quote.textContent="Ответ: "+m.reply_body;node.append(quote);}
  if((m.message_type==="audio" || m.message_type==="video_note") && m.audio_base64){
    if(m.message_type==="video_note"){
      const video=document.createElement("video"); video.controls=true; video.playsInline=true; video.preload="metadata";
      video.src="data:"+(m.audio_mime||"video/webm")+";base64,"+m.audio_base64; video.className="kiko-video-note"; node.append(video);
      const caption=document.createElement("small"); caption.className="voice-caption"; caption.textContent="Видеокружок"; node.append(caption);
    } else {
      const audio=document.createElement("audio"); audio.controls=true; audio.preload="metadata"; audio.setAttribute("playsinline","");
      audio.src="data:"+(m.audio_mime||"audio/webm")+";base64,"+m.audio_base64; audio.className="voice-player"; node.append(audio);
      const caption=document.createElement("small"); caption.className="voice-caption"; caption.textContent="Голосовое сообщение"; node.append(caption);
    }
  } else { node.append(document.createTextNode(m.body||"")); }
  const stamp=document.createElement("time"); stamp.textContent=time(m.created_at); node.append(stamp);
  const reactionArea=document.createElement("div"); reactionArea.className="reaction-area";
  const chips=document.createElement("div"); chips.className="reaction-chips"; reactionArea.append(chips);
  const picker=document.createElement("div"); picker.className="reaction-picker hidden";
  ["❤️","👍","😂","😮","😢","🔥","👏","😍"].forEach(emoji=>{
    const choice=document.createElement("button"); choice.type="button"; choice.textContent=emoji; choice.setAttribute("aria-label","Поставить реакцию "+emoji);
    choice.onclick=async()=>{try{const data=await api("/api/messages/"+m.id+"/reaction",{method:"POST",body:JSON.stringify({emoji})});updateMessageReactions(data);picker.classList.add("hidden");}catch(e){toast(e.message);}};
    picker.append(choice);
  });
  const add=document.createElement("button"); add.type="button"; add.className="reaction-add"; add.textContent="＋"; add.setAttribute("aria-label","Добавить реакцию");
  add.onclick=()=>picker.classList.toggle("hidden");
  reactionArea.append(add,picker); node.append(reactionArea);
  $("messages").append(node); renderReactionChips(chips,m.reactions||[],m.id); if(stickToBottom) $("messages").scrollTop=$("messages").scrollHeight;
}
function renderCallHistory(call){
  if(!activePerson||!call||!((call.caller_id===me.id&&call.recipient_id===activePerson.id)||(call.recipient_id===me.id&&call.caller_id===activePerson.id)))return;
  let node=$("messages").querySelector('[data-call="'+call.call_id+'"]');
  if(!node){node=document.createElement("div");node.className="call-history-item";node.dataset.call=call.call_id;$("messages").append(node);}
  const started=new Date(call.started_at),ended=call.ended_at?new Date(call.ended_at):null;
  const duration=Math.max(0,Number(call.duration_seconds)||0),mins=Math.floor(duration/60),secs=duration%60;
  const durationText=mins?mins+" мин "+(secs?secs+" сек":""):secs+" сек";
  const outgoing=call.caller_id===me.id;
  node.innerHTML='<div class="call-history-icon">'+(call.call_type==="video"?"▣":"☎")+'</div><div class="call-history-copy"><b>'+(call.call_type==="video"?"Видеозвонок":"Аудиозвонок")+'</b><span>'+(outgoing?"Исходящий":"Входящий")+' · '+(call.status==="completed"?"Завершён":"Идёт")+'</span><small>Начало: '+escapeHtml(time(started))+(ended?' · Конец: '+escapeHtml(time(ended)):"")+'</small>'+(ended?'<small>Длительность: '+escapeHtml(durationText)+'</small>':'')+'</div>';
  if($("messages").lastElementChild===node)$("messages").scrollTop=$("messages").scrollHeight;
}
function renderReactionChips(container,reactions,messageId){
  container.innerHTML="";
  (reactions||[]).forEach(r=>{
    const chip=document.createElement("button"); chip.type="button"; chip.className="reaction-chip"+(r.mine?" mine":"");
    chip.textContent=r.emoji+" "+r.count; chip.title=r.mine?"Убрать свою реакцию":"Поставить реакцию";
    chip.onclick=async()=>{try{const data=await api("/api/messages/"+messageId+"/reaction",{method:"POST",body:JSON.stringify({emoji:r.emoji})});updateMessageReactions(data);}catch(e){toast(e.message);}};
    container.append(chip);
  });
}
function updateMessageReactions(data){
  if(!data?.messageId)return;
  const node=$("messages").querySelector('[data-message="'+data.messageId+'"]');
  const chips=node?.querySelector(".reaction-chips");
  if(chips)renderReactionChips(chips,data.reactions||[],data.messageId);
}
$("messageForm").addEventListener("submit",e=>{
  e.preventDefault(); if(!activePerson||!socket)return; const body=$("messageText").value.trim(); if(!body)return;
  socket.emit("message:send",{recipientId:activePerson.id,body},result=>{
    if(!result?.ok){toast(result?.error||"Не удалось отправить");return;}
    $("messageText").value="";window.kikoAchievementTrack?.("message_sent");
    if(result.message && !$("messages").querySelector('[data-message="'+result.message.id+'"]')) appendMessage(result.message);
  });
});


const rtcConfig={iceServers:[{urls:"stun:stun.l.google.com:19302"}]};
function setCallStatus(text){$("callStatus").textContent=text;}
function showCallOverlay(){ $("callOverlay").classList.add("fullscreen-call"); if(callMode==="video") $("callOverlay").classList.add("video-call"); else $("callOverlay").classList.remove("video-call"); $("callOverlay").classList.remove("hidden"); }
function hideCallOverlay(){ $("callOverlay").classList.add("hidden"); $("callOverlay").classList.remove("fullscreen-call","video-call"); }
async function startCall(mode){
  if(!activePerson||!socket)return toast("Сначала открой личный чат");
  if(peerConnection)return toast("Звонок уже идёт");
  callPeer=activePerson.id;callMode=mode;incomingOffer=null;queuedIce=[];callId=crypto.randomUUID();callHistoryStarted=false;callInitiatorId=me.id;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Для звонков нужен доступ к камере и микрофону по HTTPS");
    localCallStream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==="video"});
    remoteCallStream=new MediaStream();
    $("localVideo").srcObject=localCallStream;$("localVideo").style.transform="none";$("remoteVideo").style.transform="none";$("remoteVideo").srcObject=remoteCallStream;
    $("remoteVideo").classList.toggle("audio-only",mode==="audio");
    $("localVideo").classList.toggle("hidden",mode==="audio");
    $("remoteAudio").srcObject=remoteCallStream;
    peerConnection=new RTCPeerConnection(rtcConfig);
    localCallStream.getTracks().forEach(track=>peerConnection.addTrack(track,localCallStream));
    peerConnection.ontrack=e=>{e.streams[0]?.getTracks().forEach(t=>remoteCallStream.addTrack(t));$("remoteVideo").srcObject=remoteCallStream;$("remoteAudio").srcObject=remoteCallStream;};
    peerConnection.onicecandidate=e=>{if(e.candidate&&callPeer)socket.emit("call:signal",{to:callPeer,type:"ice",data:e.candidate,callType:mode});};
    peerConnection.onconnectionstatechange=()=>{if(!peerConnection)return; if(peerConnection.connectionState==="connected"){setCallStatus("На связи");startCallHistory();} if(["failed","disconnected"].includes(peerConnection.connectionState))setCallStatus("Связь прервана");};
    $("callTitle").textContent=(mode==="video"?"Видеозвонок: ":"Аудиозвонок: ")+activePerson.username;
    $("incomingCallActions").classList.add("hidden");$("activeCallActions").classList.remove("hidden");$("toggleCamera").classList.toggle("hidden",mode==="audio");
    setCallStatus("Вызов…");showCallOverlay();
    const offer=await peerConnection.createOffer();await peerConnection.setLocalDescription(offer);
    socket.emit("call:signal",{to:callPeer,type:"offer",data:offer,callType:mode,callId});
  }catch(e){finishCall(false);toast(e.message||"Не удалось начать звонок");}
}
async function handleCallSignal(msg){
  if(!msg||!socket)return;
  if(msg.type==="offer"){
    if(peerConnection||incomingOffer){socket.emit("call:signal",{to:msg.from,type:"busy"});return;}
    incomingOffer=msg;callPeer=msg.from;callMode=msg.callType==="video"?"video":"audio";callId=msg.callId||crypto.randomUUID();callHistoryStarted=false;callInitiatorId=msg.from;
    $("callTitle").textContent=callMode==="video"?"Входящий видеозвонок":"Входящий аудиозвонок";
    $("incomingCallText").textContent=(msg.fromName||"Пользователь")+" звонит тебе";
    $("incomingCallActions").classList.remove("hidden");$("activeCallActions").classList.add("hidden");$("callMedia").classList.add("hidden");showCallOverlay();return;
  }
  if(msg.from!==callPeer)return;
  if(msg.type==="reject"||msg.type==="busy"||msg.type==="end"){finishCall(false);toast(msg.type==="busy"?"Собеседник уже разговаривает":msg.type==="reject"?"Звонок отклонён":"Звонок завершён");return;}
  if(msg.type==="answer"&&peerConnection){await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));for(const c of queuedIce.splice(0))await peerConnection.addIceCandidate(new RTCIceCandidate(c));setCallStatus("Соединяем…");}
  if(msg.type==="ice"&&callPeer){if(peerConnection?.remoteDescription)await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data));else queuedIce.push(msg.data);}
}
async function acceptCall(){
  if(!incomingOffer)return;
  const offer=incomingOffer;incomingOffer=null;
  try{
    localCallStream=await navigator.mediaDevices.getUserMedia({audio:true,video:callMode==="video"});
    remoteCallStream=new MediaStream();$("localVideo").srcObject=localCallStream;$("localVideo").style.transform="scaleX(-1)";$("remoteVideo").style.transform="none";$("remoteVideo").srcObject=remoteCallStream;$("remoteAudio").srcObject=remoteCallStream;
    $("localVideo").classList.toggle("hidden",callMode==="audio");$("remoteVideo").classList.toggle("audio-only",callMode==="audio");
    $("callMedia").classList.remove("hidden");$("incomingCallActions").classList.add("hidden");$("activeCallActions").classList.remove("hidden");$("toggleCamera").classList.toggle("hidden",callMode==="audio");
    peerConnection=new RTCPeerConnection(rtcConfig);
    localCallStream.getTracks().forEach(t=>peerConnection.addTrack(t,localCallStream));
    peerConnection.ontrack=e=>{e.streams[0]?.getTracks().forEach(t=>remoteCallStream.addTrack(t));$("remoteVideo").srcObject=remoteCallStream;$("remoteAudio").srcObject=remoteCallStream;};
    peerConnection.onicecandidate=e=>{if(e.candidate)socket.emit("call:signal",{to:callPeer,type:"ice",data:e.candidate,callType:callMode});};
    peerConnection.onconnectionstatechange=()=>{if(peerConnection?.connectionState==="connected"){setCallStatus("На связи");startCallHistory();}};
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer.data));
    for(const c of queuedIce.splice(0))await peerConnection.addIceCandidate(new RTCIceCandidate(c));
    const answer=await peerConnection.createAnswer();await peerConnection.setLocalDescription(answer);
    socket.emit("call:signal",{to:callPeer,type:"answer",data:answer,callType:callMode,callId});setCallStatus("Соединяем…");
  }catch(e){socket.emit("call:signal",{to:callPeer,type:"reject"});finishCall(false);toast("Не удалось подключиться к звонку. Проверь разрешения камеры и микрофона.");}
}
function startCallHistory(){
  if(callHistoryStarted||!callPeer||!socket||!callId||incomingOffer||me.id!==callInitiatorId)return;
  callHistoryStarted=true;window.kikoAchievementTrack?.("call_started");
  socket.emit("call:history:start",{to:callPeer,callId,callType:callMode});
}
function finishCall(notify=true){
  if(callHistoryStarted&&callId&&socket)socket.emit("call:history:end",{callId});
  if(notify&&callPeer&&socket)socket.emit("call:signal",{to:callPeer,type:"end",callId});
  if(peerConnection){peerConnection.ontrack=null;peerConnection.onicecandidate=null;peerConnection.close();}
  peerConnection=null;if(localCallStream)localCallStream.getTracks().forEach(t=>t.stop());
  localCallStream=null;remoteCallStream=null;callPeer=null;incomingOffer=null;queuedIce=[];callId=null;callHistoryStarted=false;callInitiatorId=null;
  $("localVideo").srcObject=null;$("remoteVideo").srcObject=null;$("remoteAudio").srcObject=null;
  $("callMedia").classList.remove("hidden");$("incomingCallActions").classList.add("hidden");$("activeCallActions").classList.add("hidden");hideCallOverlay();
}
$("mobileChatBack").onclick=()=>{$("chatLayout").classList.remove("mobile-chat-open");};
$("audioCallButton").onclick=()=>startCall("audio");
$("videoCallButton").onclick=()=>startCall("video");
$("acceptCall").onclick=acceptCall;
$("declineCall").onclick=()=>{if(callPeer&&socket)socket.emit("call:signal",{to:callPeer,type:"reject"});finishCall(false);};
$("endCall").onclick=()=>finishCall(true);
$("callClose").onclick=()=>finishCall(true);
$("toggleMic").onclick=()=>{const t=localCallStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$("toggleMic").textContent=t.enabled?"🎙 Выкл. микрофон":"🎙 Включить микрофон";}};
$("toggleCamera").onclick=()=>{const t=localCallStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$("toggleCamera").textContent=t.enabled?"📷 Выкл. камеру":"📷 Включить камеру";}};

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
          if(result.message)appendMessage(result.message); window.kikoAchievementTrack?.("message_sent");
        });
      }catch(err){button.disabled=false;toast("Не удалось подготовить аудио");}
    };
    recorder.start();button.textContent="■";button.classList.add("recording");toast("Идёт запись. Нажми ■, чтобы отправить");
  }catch(err){toast("Разреши доступ к микрофону для записи");}
});

/* KIKO video notes */
(() => {
  const audioButton=$("recordButton");
  if(!audioButton || $("videoNoteButton")) return;
  const videoButton=document.createElement("button");
  videoButton.id="videoNoteButton";videoButton.type="button";videoButton.className="tool-btn kiko-video-note-button";
  videoButton.textContent="◉";videoButton.title="Записать видеокружок";videoButton.setAttribute("aria-label","Записать видеокружок");
  audioButton.insertAdjacentElement("afterend",videoButton);
  const style=document.createElement("style");
  style.textContent=".kiko-video-note-button{font-size:20px;color:#a45c80}.kiko-video-note-button.recording{background:#ffe0eb;color:#c52c68;animation:kikoRecPulse 1s infinite alternate}.kiko-video-note{display:block;width:min(260px,65vw);height:min(260px,65vw);object-fit:cover;border-radius:50%;background:#17131c;margin:4px auto}.bubble:has(.kiko-video-note){max-width:300px}@keyframes kikoRecPulse{to{transform:scale(1.07);box-shadow:0 0 0 5px #ed8bb544}}";
  document.head.append(style);
  let videoRecorder=null,videoChunks=[],videoStream=null,videoTimer=null;
  const reset=()=>{clearTimeout(videoTimer);videoTimer=null;if(videoStream){videoStream.getTracks().forEach(t=>t.stop());videoStream=null;}videoRecorder=null;videoChunks=[];videoButton.classList.remove("recording");videoButton.textContent="◉";videoButton.disabled=false;};
  videoButton.addEventListener("click",async()=>{
    if(videoRecorder && videoRecorder.state==="recording"){videoRecorder.stop();videoButton.textContent="◉";videoButton.classList.remove("recording");return;}
    if(!activePerson||!socket){toast("Сначала открой личный чат");return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast("Запись видео не поддерживается этим браузером");return;}
    try{
      videoStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:480},height:{ideal:480}},audio:true});
      const formats=["video/webm;codecs=vp8,opus","video/webm","video/mp4"];
      const mime=formats.find(t=>MediaRecorder.isTypeSupported(t));
      videoRecorder=new MediaRecorder(videoStream,mime?{mimeType:mime}:{});videoChunks=[];
      videoRecorder.ondataavailable=e=>{if(e.data?.size)videoChunks.push(e.data);};
      videoRecorder.onerror=()=>{reset();toast("Не удалось записать видеокружок");};
      videoRecorder.onstop=async()=>{
        clearTimeout(videoTimer);
        const recorder=videoRecorder;
        if(videoStream){videoStream.getTracks().forEach(t=>t.stop());videoStream=null;}
        const blob=new Blob(videoChunks,{type:recorder?.mimeType||"video/webm"});
        videoRecorder=null;videoChunks=[];videoButton.textContent="◉";videoButton.classList.remove("recording");
        if(!blob.size){videoButton.disabled=false;toast("Видео не записалось");return;}
        if(blob.size>5*1024*1024){videoButton.disabled=false;toast("Видеокружок слишком большой (максимум 5 МБ). Запиши короче");return;}
        videoButton.disabled=true;toast("Отправляем видеокружок…");
        try{
          const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
          const recipientId=activePerson?.id;
          if(!recipientId||!socket){videoButton.disabled=false;toast("Чат уже закрыт");return;}
          socket.emit("message:send",{recipientId,video_note_base64:base64,video_note_mime:blob.type},result=>{
            videoButton.disabled=false;
            if(!result?.ok){toast(result?.error||"Не удалось отправить видеокружок");return;}
            if(result.message)appendMessage(result.message);window.kikoAchievementTrack?.("message_sent");
          });
        }catch(e){videoButton.disabled=false;toast("Не удалось подготовить видеокружок");}
      };
      videoRecorder.start(250);videoButton.textContent="■";videoButton.classList.add("recording");toast("Запись видеокружка. Нажми ■ для отправки");
      videoTimer=setTimeout(()=>{if(videoRecorder?.state==="recording"){toast("Максимум 30 секунд — отправляем");videoRecorder.stop();}},30000);
    }catch(e){reset();toast("Разреши доступ к камере и микрофону");}
  });
  window.addEventListener("beforeunload",()=>{clearTimeout(videoTimer);videoStream?.getTracks().forEach(t=>t.stop());});
})();

boot();