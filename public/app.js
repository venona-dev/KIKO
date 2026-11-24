const $ = id => document.getElementById(id);
let token = localStorage.getItem("kiko_token");
let me = null, socket = null, authMode = "login", activePerson = null, knownPeople = [];
let peerConnection=null, localCallStream=null, remoteCallStream=null, callPeer=null, callMode="audio", incomingOffer=null, queuedIce=[];
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
function showApp() {
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("myName").textContent = me.username; $("myAvatar").textContent = initials(me.username); $("postAvatar").textContent = initials(me.username);
  socket = io({ auth: { token } });
  socket.on("connect_error", err => toast("Связь с сервером прервана. Переподключаемся…"));
  socket.on("call:signal", handleCallSignal);
  socket.on("message:new", message => { if (activePerson && (message.sender_id === activePerson.id || message.recipient_id === activePerson.id)) appendMessage(message); });
  socket.on("message:reaction", data => updateMessageReactions(data));
  socket.on("post:new", post => { if (!$("feed").querySelector('[data-id="' + post.id + '"]')) renderPost(post, true); });
  socket.on("post:like", data => { const card = $("feed").querySelector('[data-id="' + data.postId + '"]'); if(card){ const btn=card.querySelector(".like-btn"); btn.textContent = (data.liked && data.userId===me.id ? "♥ " : "♡ ") + data.likes; if(data.userId===me.id) btn.classList.toggle("liked",data.liked); } });
  loadFeed();
  loadPeople();
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
  await syncMessages();
}
async function syncMessages(){
  if(!activePerson || !token)return;
  const personId=activePerson.id;
  try { const list=await api("/api/messages/"+personId); if(activePerson?.id!==personId)return; list.forEach(appendMessage); }
  catch(e){ if(e.message!=="Не авторизован") console.warn("Message sync failed",e); }
}
setInterval(syncMessages,4000);
function appendMessage(m) {
  if(!activePerson || $("messages").querySelector('[data-message="'+m.id+'"]')) return;
  const node=document.createElement("div"); node.className="bubble "+(m.sender_id===me.id?"mine":""); node.dataset.message=m.id;
  if(m.message_type==="audio" && m.audio_base64){
    const audio=document.createElement("audio"); audio.controls=true; audio.preload="metadata"; audio.setAttribute("playsinline","");
    audio.src="data:"+(m.audio_mime||"audio/webm")+";base64,"+m.audio_base64; audio.className="voice-player"; node.append(audio);
    const caption=document.createElement("small"); caption.className="voice-caption"; caption.textContent="Голосовое сообщение"; node.append(caption);
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
  $("messages").append(node); renderReactionChips(chips,m.reactions||[],m.id); $("messages").scrollTop=$("messages").scrollHeight;
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
    $("messageText").value="";
    if(result.message && !$("messages").querySelector('[data-message="'+result.message.id+'"]')) appendMessage(result.message);
  });
});


const rtcConfig={iceServers:[{urls:"stun:stun.l.google.com:19302"}]};
function setCallStatus(text){$("callStatus").textContent=text;}
function showCallOverlay(){ $("callOverlay").classList.remove("hidden"); }
function hideCallOverlay(){ $("callOverlay").classList.add("hidden"); }
async function startCall(mode){
  if(!activePerson||!socket)return toast("Сначала открой личный чат");
  if(peerConnection)return toast("Звонок уже идёт");
  callPeer=activePerson.id;callMode=mode;incomingOffer=null;queuedIce=[];
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Для звонков нужен доступ к камере и микрофону по HTTPS");
    localCallStream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==="video"});
    remoteCallStream=new MediaStream();
    $("localVideo").srcObject=localCallStream;$("remoteVideo").srcObject=remoteCallStream;
    $("remoteVideo").classList.toggle("audio-only",mode==="audio");
    $("localVideo").classList.toggle("hidden",mode==="audio");
    $("remoteAudio").srcObject=remoteCallStream;
    peerConnection=new RTCPeerConnection(rtcConfig);
    localCallStream.getTracks().forEach(track=>peerConnection.addTrack(track,localCallStream));
    peerConnection.ontrack=e=>{e.streams[0]?.getTracks().forEach(t=>remoteCallStream.addTrack(t));$("remoteVideo").srcObject=remoteCallStream;$("remoteAudio").srcObject=remoteCallStream;};
    peerConnection.onicecandidate=e=>{if(e.candidate&&callPeer)socket.emit("call:signal",{to:callPeer,type:"ice",data:e.candidate,callType:mode});};
    peerConnection.onconnectionstatechange=()=>{if(!peerConnection)return; if(peerConnection.connectionState==="connected")setCallStatus("На связи"); if(["failed","disconnected"].includes(peerConnection.connectionState))setCallStatus("Связь прервана");};
    $("callTitle").textContent=(mode==="video"?"Видеозвонок: ":"Аудиозвонок: ")+activePerson.username;
    $("incomingCallActions").classList.add("hidden");$("activeCallActions").classList.remove("hidden");$("toggleCamera").classList.toggle("hidden",mode==="audio");
    setCallStatus("Вызов…");showCallOverlay();
    const offer=await peerConnection.createOffer();await peerConnection.setLocalDescription(offer);
    socket.emit("call:signal",{to:callPeer,type:"offer",data:offer,callType:mode});
  }catch(e){finishCall(false);toast(e.message||"Не удалось начать звонок");}
}
async function handleCallSignal(msg){
  if(!msg||!socket)return;
  if(msg.type==="offer"){
    if(peerConnection||incomingOffer){socket.emit("call:signal",{to:msg.from,type:"busy"});return;}
    incomingOffer=msg;callPeer=msg.from;callMode=msg.callType==="video"?"video":"audio";
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
    remoteCallStream=new MediaStream();$("localVideo").srcObject=localCallStream;$("remoteVideo").srcObject=remoteCallStream;$("remoteAudio").srcObject=remoteCallStream;
    $("localVideo").classList.toggle("hidden",callMode==="audio");$("remoteVideo").classList.toggle("audio-only",callMode==="audio");
    $("callMedia").classList.remove("hidden");$("incomingCallActions").classList.add("hidden");$("activeCallActions").classList.remove("hidden");$("toggleCamera").classList.toggle("hidden",callMode==="audio");
    peerConnection=new RTCPeerConnection(rtcConfig);
    localCallStream.getTracks().forEach(t=>peerConnection.addTrack(t,localCallStream));
    peerConnection.ontrack=e=>{e.streams[0]?.getTracks().forEach(t=>remoteCallStream.addTrack(t));$("remoteVideo").srcObject=remoteCallStream;$("remoteAudio").srcObject=remoteCallStream;};
    peerConnection.onicecandidate=e=>{if(e.candidate)socket.emit("call:signal",{to:callPeer,type:"ice",data:e.candidate,callType:callMode});};
    peerConnection.onconnectionstatechange=()=>{if(peerConnection?.connectionState==="connected")setCallStatus("На связи");};
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer.data));
    for(const c of queuedIce.splice(0))await peerConnection.addIceCandidate(new RTCIceCandidate(c));
    const answer=await peerConnection.createAnswer();await peerConnection.setLocalDescription(answer);
    socket.emit("call:signal",{to:callPeer,type:"answer",data:answer,callType:callMode});setCallStatus("Соединяем…");
  }catch(e){socket.emit("call:signal",{to:callPeer,type:"reject"});finishCall(false);toast("Не удалось подключиться к звонку. Проверь разрешения камеры и микрофона.");}
}
function finishCall(notify=true){
  if(notify&&callPeer&&socket)socket.emit("call:signal",{to:callPeer,type:"end"});
  if(peerConnection){peerConnection.ontrack=null;peerConnection.onicecandidate=null;peerConnection.close();}
  peerConnection=null;if(localCallStream)localCallStream.getTracks().forEach(t=>t.stop());
  localCallStream=null;remoteCallStream=null;callPeer=null;incomingOffer=null;queuedIce=[];
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
          if(result.message)appendMessage(result.message);
        });
      }catch(err){button.disabled=false;toast("Не удалось подготовить аудио");}
    };
    recorder.start();button.textContent="■";button.classList.add("recording");toast("Идёт запись. Нажми ■, чтобы отправить");
  }catch(err){toast("Разреши доступ к микрофону для записи");}
});
boot();