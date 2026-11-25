/* KIKO Plus: conversations, groups, stories, privacy and personal tools */
(() => {
  const $ = id => document.getElementById(id);
  const api2 = (url, opts={}) => api(url, opts);
  let replyTarget=null, activeGroup=null, groups=[], storyItems=[];
  const button=(label,cls="feature-btn")=>{const b=document.createElement("button");b.type="button";b.className=cls;b.textContent=label;return b;};
  const section=(title)=>{const s=document.createElement("section");s.className="feature-card";const h=document.createElement("h3");h.textContent=title;s.append(h);return s;};
  function addFeatureStyles(){const style=document.createElement("style");style.textContent=`
    .feature-card{background:var(--panel,#fff);border:1px solid #f1e1e9;border-radius:16px;padding:14px;margin:12px 0;color:var(--ink,#715665)}
    .feature-card h3{font-size:14px;margin:0 0 10px}.feature-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .feature-btn{background:#fff0f5;color:#a9587a;border:1px solid #f1d9e4;border-radius:10px;padding:8px 11px;font-size:11px}
    .feature-btn:hover{background:#ffe4ee}.feature-input{min-width:0;flex:1;padding:10px;border:1px solid #eddce4;border-radius:10px;background:#fffafd;color:#574550;font:inherit;font-size:12px}
    .feature-muted{font-size:11px;color:#a58e99}.feature-list{display:grid;gap:6px}.feature-list button{text-align:left}
    .story-strip{display:flex;gap:9px;overflow:auto;padding:5px 0 12px}.story-bubble{flex:0 0 76px;width:76px;height:94px;border-radius:17px;background:linear-gradient(145deg,#fff0f6,#eee8ff);border:1px solid #f0dce7;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;color:#a65e7d;font-size:10px;overflow:hidden}
    .story-bubble img{width:100%;height:65px;object-fit:cover}.story-bubble span{max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .message-tools{display:flex;gap:6px;align-items:center}.message-tools button{font-size:11px;padding:5px 7px}
    .message-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.message-actions button{background:transparent;color:#a47b8e;font-size:10px;padding:3px 5px}
    .reply-preview{border-left:3px solid #df91b0;padding:5px 8px;margin-bottom:6px;background:#fff6fa;border-radius:5px;font-size:10px;color:#95677e}
    .edited-label{font-size:9px;color:#b58a9e;margin-left:5px}.typing-indicator{font-size:10px;color:#c16f94;margin-left:auto}
    .feature-overlay{position:fixed;inset:0;z-index:120;background:#24182188;display:grid;place-items:center;padding:16px}.feature-dialog{width:min(560px,100%);max-height:85dvh;overflow:auto;background:#fff;border-radius:18px;padding:18px;box-shadow:0 18px 70px #0003}.feature-dialog h3{margin:0 0 12px;color:#765365}.feature-dialog p{font-size:12px;color:#927b87;line-height:1.6}.feature-dialog img{max-width:100%;max-height:55vh;border-radius:12px}
    .group-row{display:flex;align-items:center;gap:9px;padding:9px;border-radius:10px;background:#fff7fa;margin:5px 0;cursor:pointer}.group-row b{font-size:12px}.group-row small{display:block;color:#a58e99;font-size:10px}
    #kikoReplyBar{display:flex;align-items:center;gap:8px;padding:7px 12px;background:#fff5f9;color:#96647b;font-size:11px}
    body[data-theme="dark"] .feature-card,body[data-theme="midnight"] .feature-card{background:#292431;border-color:#453b4a;color:#f0e7f0}
    body[data-theme="dark"] .feature-input,body[data-theme="midnight"] .feature-input{background:#211e28;color:#f4edf5;border-color:#514455}
    @media(max-width:700px){.feature-dialog{padding:14px}.message-actions button{font-size:11px;padding:5px}}
  `;document.head.append(style);}
  function dialog(title,content){const overlay=document.createElement("div");overlay.className="feature-overlay";const box=document.createElement("div");box.className="feature-dialog";const h=document.createElement("h3");h.textContent=title;box.append(h,content);const close=button("Закрыть");close.onclick=()=>overlay.remove();box.append(close);overlay.append(box);overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};document.body.append(overlay);return overlay;}
  function makeInput(placeholder,value=""){const i=document.createElement("input");i.className="feature-input";i.placeholder=placeholder;i.value=value;return i;}
  async function loadStories(){try{storyItems=await api2("/api/features/stories");renderStories();}catch(e){console.warn(e);}}
  function renderStories(){const strip=$("kikoStories");if(!strip)return;strip.innerHTML="";const add=button("＋\nМоя история","story-bubble");add.onclick=createStory;strip.append(add);storyItems.forEach(s=>{const b=button("","story-bubble");if(s.media_data){const im=document.createElement("img");im.src=s.media_data;b.append(im);}const t=document.createElement("span");t.textContent=s.username;b.append(t);b.onclick=()=>viewStory(s);strip.append(b);});}
  function createStory(){const wrap=document.createElement("div"),text=document.createElement("textarea");text.className="feature-input";text.placeholder="Что происходит?";text.rows=3;const file=document.createElement("input");file.type="file";file.accept="image/png,image/jpeg,image/webp,image/gif";file.className="feature-input";const send=button("Опубликовать");send.onclick=async()=>{try{let media_data="",media_mime="";if(file.files[0]){if(file.files[0].size>1800000)throw Error("Фото должно быть меньше 1,8 МБ");media_mime=file.files[0].type;media_data=await readData(file.files[0]);}await api2("/api/features/stories",{method:"POST",body:JSON.stringify({body:text.value,media_data,media_mime})});window.kikoAchievementTrack?.("story_created");document.querySelector(".feature-overlay")?.remove();await loadStories();toast("История опубликована");}catch(e){toast(e.message);}};wrap.append(text,file,send);dialog("Новая история",wrap);}
  function viewStory(s){const wrap=document.createElement("div");if(s.media_data){const im=document.createElement("img");im.src=s.media_data;wrap.append(im);}const p=document.createElement("p");p.textContent=s.body||"История";wrap.append(p);if(s.user_id===me.id){const del=button("Удалить историю");del.onclick=async()=>{try{await api2("/api/features/stories/"+s.id,{method:"DELETE"});document.querySelector(".feature-overlay")?.remove();loadStories();}catch(e){toast(e.message);}};wrap.append(del);}dialog("История · "+s.username,wrap);}
  function readData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);});}
  function ensureStories(){if($("kikoStories"))return;const wall=$("wallView");const card=section("Истории · 24 часа");const strip=document.createElement("div");strip.id="kikoStories";strip.className="story-strip";card.append(strip);wall.prepend(card);}
  function ensureChatTools(){const form=$("messageForm"),head=$("chatActive")?.querySelector(".chat-head");if(!form||!head)return;
    if(!$("kikoChatMore")){
      const menu=document.createElement("div");menu.id="kikoChatMore";menu.className="kiko-chat-menu hidden";menu.setAttribute("role","menu");
      const trigger=button("⋯","kiko-chat-more-trigger");trigger.id="kikoChatMoreTrigger";trigger.title="Возможности чата";trigger.setAttribute("aria-label","Возможности чата");trigger.setAttribute("aria-expanded","false");
      trigger.onclick=e=>{e.stopPropagation();const open=menu.classList.toggle("hidden")===false;trigger.setAttribute("aria-expanded",String(open));};
      head.append(menu,trigger);
      document.addEventListener("click",e=>{if(!menu.contains(e.target)&&e.target!==trigger){menu.classList.add("hidden");trigger.setAttribute("aria-expanded","false");}});
      const addMenu=(label,action,id)=>{const b=button(label,"kiko-chat-menu-item");if(id)b.id=id;b.setAttribute("role","menuitem");b.onclick=()=>{menu.classList.add("hidden");trigger.setAttribute("aria-expanded","false");action();};menu.append(b);return b;};
      addMenu("Настройки чата",chatSettings,"kikoMenuSettings");
      addMenu("Закреплённые сообщения",showPinned,"kikoMenuPinned");
      addMenu("Поиск по переписке",searchMessages,"kikoMenuSearch");
      addMenu("Прикрепить файл",()=> $("kikoFileInput")?.click(),"kikoMenuAttach");
      addMenu("Стикеры и эмодзи",stickerPicker,"kikoMenuStickers");
      addMenu("Голосовое сообщение",()=> $("recordButton")?.click(),"kikoMenuVoice");
      addMenu("Отложенное сообщение",()=>{if(window.kikoScheduleMessage)window.kikoScheduleMessage();else $("kikoScheduleButton")?.click();},"kikoMenuSchedule");
      addMenu("Заблокировать собеседника",()=>{if(activePerson)api2("/api/features/block/"+activePerson.id,{method:"POST"}).then(()=>toast("Пользователь заблокирован")).catch(e=>toast(e.message));},"kikoMenuBlock");
      addMenu("Пожаловаться",()=>{if(!activePerson)return;const reason=prompt("Причина жалобы");if(reason)api2("/api/features/report/"+activePerson.id,{method:"POST",body:JSON.stringify({reason})}).then(()=>toast("Жалоба отправлена")).catch(e=>toast(e.message));},"kikoMenuReport");
    }
    if(!$("kikoReplyBar")){const reply=document.createElement("div");reply.id="kikoReplyBar";reply.classList.add("hidden");reply.innerHTML="<span>Ответ на сообщение</span><b></b>";const cancel=button("×");cancel.onclick=()=>setReply(null);reply.append(cancel);form.before(reply);}
    let file=$("kikoFileInput");if(!file){file=document.createElement("input");file.id="kikoFileInput";file.type="file";file.className="hidden";file.accept="image/*,video/*,application/pdf,.doc,.docx,.txt,.zip";file.onchange=async()=>{if(!file.files[0]||!activePerson)return;try{const f=file.files[0];if(f.size>5*1024*1024)throw Error("Максимальный размер файла — 5 МБ");const data=(await readData(f)).split(",")[1];const m=await api2("/api/features/messages/"+activePerson.id+"/attachment",{method:"POST",body:JSON.stringify({name:f.name,mime:f.type,data})});if(m)appendMessage(m);file.value="";}catch(e){toast(e.message);}};form.append(file);}
    if(!$("kikoAttachButton")){const attach=button("＋","tool-btn kiko-compose-side-btn");attach.id="kikoAttachButton";attach.title="Прикрепить файл";attach.setAttribute("aria-label","Прикрепить файл");attach.onclick=()=>file.click();form.insertBefore(attach,$("messageText"));}
    if(!$("kikoStickerButton")){const stickers=button("☺","tool-btn kiko-compose-side-btn");stickers.id="kikoStickerButton";stickers.title="Стикеры и эмодзи";stickers.setAttribute("aria-label","Стикеры и эмодзи");stickers.onclick=stickerPicker;form.insertBefore(stickers,$("messageText"));}
    $("kikoMenuAttach")?.remove();$("kikoMenuStickers")?.remove();$("kikoMenuVoice")?.remove();

    const menu=$("kikoChatMore");if(menu){
      const schedule=$("kikoScheduleButton");if(schedule&&schedule.parentElement!==menu){schedule.classList.add("kiko-chat-menu-item");schedule.textContent="Отложенное сообщение";menu.querySelector("#kikoMenuSchedule")?.remove();menu.append(schedule);}
    }
    const oldPinned=head.querySelector(".feature-btn"),oldSafety=$("kikoUserSafety");oldPinned?.remove();oldSafety?.remove();
  }
  function setReply(m){replyTarget=m;if(!$("kikoReplyBar"))return;const bar=$("kikoReplyBar");bar.classList.toggle("hidden",!m);bar.querySelector("b").textContent=m?(m.body||"Вложение").slice(0,90):"";}
  function decorateMessage(node){if(node.dataset.kikoDecorated)return;node.dataset.kikoDecorated="1";const id=Number(node.dataset.message);if(!id)return;
    const actions=document.createElement("div");actions.className="message-actions";
    const reply=button("Ответить");reply.onclick=()=>{const m={id,body:node.childNodes[0]?.textContent||"Сообщение"};setReply(m);$("messageText").focus();};
    const pin=button("Закрепить");pin.onclick=async()=>{try{await api2("/api/features/messages/"+id+"/pin",{method:"POST",body:JSON.stringify({pinned:true})});toast("Сообщение закреплено");}catch(e){toast(e.message);}};
    actions.append(reply,pin);
    if(node.classList.contains("mine")){const edit=button("Изменить");edit.onclick=async()=>{const current=node.childNodes[0]?.textContent||"";const next=prompt("Изменить сообщение",current);if(next===null)return;try{await api2("/api/features/messages/"+id,{method:"PATCH",body:JSON.stringify({body:next})});node.childNodes[0].textContent=next;toast("Сообщение изменено");}catch(e){toast(e.message);}};const del=button("Удалить");del.onclick=async()=>{if(!confirm("Удалить сообщение у обоих участников?"))return;try{await api2("/api/features/messages/"+id+"?mode=everyone",{method:"DELETE"});node.remove();}catch(e){toast(e.message);}};actions.append(edit,del);}
    const download=button("Скачать вложение");download.onclick=async()=>{try{const res=await fetch("/api/features/messages/"+id+"/download",{headers:{Authorization:"Bearer "+token}});if(!res.ok)throw Error("Файл недоступен");const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="kiko-file";a.click();URL.revokeObjectURL(url);}catch(e){toast(e.message);}};
    if(node.textContent.includes("file")||node.querySelector("audio")){} 
    if(node.dataset.messageType==="file"){download.textContent="Скачать файл";actions.append(download);}
    node.append(actions);
  }
  function watchMessages(){const box=$("messages");if(!box)return;new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1&&n.classList.contains("bubble"))decorateMessage(n);}))).observe(box,{childList:true});box.querySelectorAll(".bubble").forEach(decorateMessage);}
  async function searchMessages(){if(!activePerson)return;const wrap=document.createElement("div"),q=makeInput("Найти в этой переписке…"),results=document.createElement("div");results.className="feature-list";const go=button("Найти");go.onclick=async()=>{try{const rows=await api2("/api/features/search?userId="+activePerson.id+"&q="+encodeURIComponent(q.value));results.innerHTML="";if(!rows.length){results.textContent="Ничего не найдено";return;}rows.forEach(m=>{const b=button(m.sender_name+": "+m.body.slice(0,130));b.onclick=()=>{const n=$("messages").querySelector('[data-message="'+m.id+'"]');n?.scrollIntoView({behavior:"smooth",block:"center"});document.querySelector(".feature-overlay")?.remove();};results.append(b);});}catch(e){toast(e.message);}};wrap.append(q,go,results);dialog("Поиск по сообщениям",wrap);}
  function stickerPicker(){const wrap=document.createElement("div"),grid=document.createElement("div");grid.className="feature-row";["❤️","😂","🥹","✨","🌸","🫶","🔥","😍","🙈","🎀","☁️","💗","👍","👏","😎","🥰"].forEach(e=>{const b=button(e);b.style.fontSize="24px";b.onclick=()=>{$("messageText").value+=$("messageText").value?" "+e:e;document.querySelector(".feature-overlay")?.remove();$("messageText").focus();};grid.append(b);});wrap.append(grid);dialog("Стикеры и эмодзи",wrap);}
  async function showPinned(){if(!activePerson)return;try{const rows=await api2("/api/messages/"+activePerson.id),p=rows.filter(m=>m.pinned);const wrap=document.createElement("div");if(!p.length)wrap.textContent="Пока нет закреплённых сообщений";p.forEach(m=>{const b=button(m.body||"Вложение");b.onclick=()=>{$("messages").querySelector('[data-message="'+m.id+'"]')?.scrollIntoView({behavior:"smooth",block:"center"});document.querySelector(".feature-overlay")?.remove();};wrap.append(b);});dialog("Закреплённые сообщения",wrap);}catch(e){toast(e.message);}}
  async function chatSettings(){if(!activePerson)return;try{const v=await api2("/api/features/chats/"+activePerson.id+"/settings"),wrap=document.createElement("div"),theme=document.createElement("select"),wall=document.createElement("select"),mute=document.createElement("input");theme.className=wall.className="feature-input";theme.innerHTML='<option value="default">Обычная</option><option value="pink">Розовая</option><option value="lavender">Лавандовая</option><option value="midnight">Ночная</option>';wall.innerHTML='<option value="default">Стандартные обои</option><option value="gradient">Градиент</option><option value="stars">Звёзды</option><option value="plain">Однотонные</option>';theme.value=v.theme;wall.value=v.wallpaper;mute.type="checkbox";mute.checked=v.muted;const label=document.createElement("label");label.textContent="Отключить уведомления";label.append(mute);const save=button("Сохранить");save.onclick=async()=>{try{await api2("/api/features/chats/"+activePerson.id+"/settings",{method:"PUT",body:JSON.stringify({theme:theme.value,wallpaper:wall.value,muted:mute.checked})});document.querySelector(".feature-overlay")?.remove();toast("Настройки чата сохранены");}catch(e){toast(e.message);}};wrap.append(theme,wall,label,save);dialog("Оформление этого чата",wrap);}catch(e){toast(e.message);}}
  async function loadGroups(){try{groups=await api2("/api/features/groups");renderGroups();}catch(e){console.warn(e);}}
  function ensureGroups(){if($("kikoGroups"))return;const panel=$("peopleList");const wrap=document.createElement("div");wrap.id="kikoGroups";const head=document.createElement("div");head.className="people-section-title";head.textContent="ГРУППЫ";const add=button("＋ Создать группу");add.onclick=createGroup;const list=document.createElement("div");list.id="kikoGroupList";wrap.append(head,add,list);panel.after(wrap);}
  function renderGroups(){const list=$("kikoGroupList");if(!list)return;list.innerHTML="";groups.forEach(g=>{const b=document.createElement("div");b.className="group-row";const t=document.createElement("div");t.innerHTML="<b></b><small></small>";t.querySelector("b").textContent=g.name;t.querySelector("small").textContent=g.last_message||"Групповой чат";b.append(t);b.onclick=()=>openGroup(g);list.append(b);});}
  function createGroup(){const wrap=document.createElement("div"),name=makeInput("Название группы"),desc=makeInput("Описание (необязательно)"),members=makeInput("Имена пользователей через запятую");const save=button("Создать");save.onclick=async()=>{try{const memberUsernames=members.value.split(",").map(x=>x.trim()).filter(Boolean);await api2("/api/features/groups",{method:"POST",body:JSON.stringify({name:name.value,description:desc.value,memberUsernames})});window.kikoAchievementTrack?.("group_created");document.querySelector(".feature-overlay")?.remove();await loadGroups();toast("Группа создана");}catch(e){toast(e.message);}};wrap.append(name,desc,members,save);dialog("Новая группа",wrap);}
  function ensureGroupMemberButton(){
    const head=$("chatActive")?.querySelector(".chat-head");if(!head||$("kikoGroupMembersButton"))return;
    const b=button("＋ Участники","feature-btn");b.id="kikoGroupMembersButton";b.title="Добавить людей в группу";b.onclick=manageGroupMembers;head.append(b);
  }
  async function manageGroupMembers(){
    if(!activeGroup)return;
    const groupId=activeGroup.id,wrap=document.createElement("div"),search=makeInput("Найти по имени пользователя…"),current=document.createElement("div"),results=document.createElement("div"),save=button("Добавить выбранных");
    current.className=results.className="feature-list";
    const selected=new Set();
    let memberIds=new Set();
    async function drawMembers(){
      const data=await api2("/api/features/groups/"+groupId+"/members");
      memberIds=new Set(data.members.map(x=>Number(x.id)));
      current.innerHTML="";
      const label=document.createElement("p");label.textContent="Участники группы · "+data.members.length;current.append(label);
      data.members.forEach(m=>{const row=document.createElement("div");row.className="group-row";row.textContent=(m.role==="admin"?"★ ":"")+m.username;current.append(row);});
      if(data.role!=="admin"){search.disabled=true;save.disabled=true;const note=document.createElement("p");note.textContent="Добавлять участников может администратор группы.";current.append(note);}
    }
    async function searchUsers(){
      const q=search.value.trim();results.innerHTML="";if(q.length<2)return;
      try{
        const users=await api2("/api/users?q="+encodeURIComponent(q));
        const available=users.filter(u=>!memberIds.has(Number(u.id)));
        if(!available.length){results.textContent="Новых пользователей не найдено";return;}
        available.forEach(user=>{
          const label=document.createElement("label");label.className="group-row";label.style.cursor="pointer";
          const check=document.createElement("input");check.type="checkbox";check.checked=selected.has(Number(user.id));
          check.onchange=()=>check.checked?selected.add(Number(user.id)):selected.delete(Number(user.id));
          const name=document.createElement("span");name.textContent="@"+user.username;label.append(check,name);results.append(label);
        });
      }catch(e){toast(e.message);}
    }
    search.addEventListener("input",searchUsers);
    save.onclick=async()=>{
      try{
        if(!selected.size)throw Error("Выбери пользователей для добавления");
        const response=await api2("/api/features/groups/"+groupId+"/members",{method:"POST",body:JSON.stringify({userIds:[...selected]})});
        document.querySelector(".feature-overlay")?.remove();await drawMembers();toast("Участники добавлены: "+response.added.length);await loadGroups();
      }catch(e){toast(e.message);}
    };
    wrap.append(current,search,results,save);
    try{await drawMembers();}catch(e){toast(e.message);return;}
    dialog("Участники · "+activeGroup.name,wrap);
  }
  async function openGroup(g){activeGroup=g;activePerson=null;$("kikoGroupMembersButton")?.remove();$("chatLayout").classList.add("mobile-chat-open");$("chatPlaceholder").classList.add("hidden");$("chatActive").classList.remove("hidden");$("chatName").textContent=g.name;$("messages").innerHTML="";if(socket)socket.emit("group:join",g.id);ensureGroupMemberButton();await loadGroupMessages();$("messageText").placeholder="Сообщение в группу…";}
  async function loadGroupMessages(){if(!activeGroup)return;try{const rows=await api2("/api/features/groups/"+activeGroup.id+"/messages");const box=$("messages");box.innerHTML="";rows.forEach(m=>{const n=document.createElement("div");n.className="bubble"+(m.sender_id===me.id?" mine":"");n.textContent=(m.username||"Участник")+": "+m.body;n.dataset.groupMessage=m.id;box.append(n);});box.scrollTop=box.scrollHeight;}catch(e){toast(e.message);}}
  async function sendGroupMessage(body){if(!activeGroup)return false;try{const m=await api2("/api/features/groups/"+activeGroup.id+"/messages",{method:"POST",body:JSON.stringify({body})});const n=document.createElement("div");n.className="bubble mine";n.textContent="Вы: "+m.body;$("messages").append(n);return true;}catch(e){toast(e.message);return true;}}
  async function loadPrivacy(){try{const v=await api2("/api/features/privacy");$("privacyLastSeen").value=v.last_seen;$("privacyProfile").value=v.profile_visibility;$("privacyReceipts").checked=v.read_receipts;$("privacyTyping").checked=v.typing_status;}catch(e){console.warn(e);}}
  function ensurePrivacy(){if($("privacyLastSeen"))return;const card=section("Приватность и безопасность");card.innerHTML+='<label class="setting-row">Кто видит время посещения<select id="privacyLastSeen"><option value="everyone">Все</option><option value="contacts">Собеседники</option><option value="nobody">Никто</option></select></label><label class="setting-row">Видимость профиля<select id="privacyProfile"><option value="everyone">Все</option><option value="contacts">Собеседники</option><option value="nobody">Никто</option></select></label><label><input id="privacyReceipts" type="checkbox" checked> Отчёты о прочтении</label><label><input id="privacyTyping" type="checkbox" checked> Показывать набор текста</label>';const save=button("Сохранить приватность");save.onclick=async()=>{try{await api2("/api/features/privacy",{method:"PUT",body:JSON.stringify({last_seen:$("privacyLastSeen").value,profile_visibility:$("privacyProfile").value,read_receipts:$("privacyReceipts").checked,typing_status:$("privacyTyping").checked})});toast("Настройки приватности сохранены");}catch(e){toast(e.message);}};card.append(save);$("accountView").querySelector(".account-shell").append(card);const safety=section("Защита и жалобы");const target=makeInput("ID пользователя");const reason=makeInput("Причина жалобы");const block=button("Заблокировать");block.onclick=async()=>{try{await api2("/api/features/block/"+Number(target.value),{method:"POST"});toast("Пользователь заблокирован");}catch(e){toast(e.message);}};const report=button("Пожаловаться");report.onclick=async()=>{try{await api2("/api/features/report/"+Number(target.value),{method:"POST",body:JSON.stringify({reason:reason.value})});toast("Жалоба отправлена");}catch(e){toast(e.message);}};safety.append(target,reason,block,report);$("accountView").querySelector(".account-shell").append(safety);}
  function installTyping(){const input=$("messageText");if(!input)return;let timer;if(!input.dataset.kikoTyping){input.dataset.kikoTyping="1";input.addEventListener("input",()=>{if(!activePerson||!socket)return;socket.emit("typing",{to:activePerson.id,active:true});clearTimeout(timer);timer=setTimeout(()=>socket.emit("typing",{to:activePerson.id,active:false}),1200);});}if(socket&&!socket.kikoFeatureEvents){socket.kikoFeatureEvents=true;socket.on("group:message",m=>{if(activeGroup&&m.group_id===activeGroup.id){const n=document.createElement("div");n.className="bubble"+(m.sender_id===me.id?" mine":"");n.textContent=(m.username||"Участник")+": "+m.body;$("messages").append(n);}});socket.on("typing",d=>{if(!activePerson||d.from!==activePerson.id)return;let n=$("kikoTyping");if(!n){n=document.createElement("small");n.id="kikoTyping";n.className="typing-indicator";$("chatName").after(n);}n.textContent=d.active?"печатает…":"";});socket.on("story:new",loadStories);socket.on("group:added",data=>{loadGroups();if(activeGroup&&data?.id===activeGroup.id){toast("Вас добавили в группу «"+activeGroup.name+"»");if(socket)socket.emit("group:join",activeGroup.id);}});socket.on("group:members-updated",data=>{if(activeGroup&&data?.groupId===activeGroup.id)loadGroups();});socket.on("message:deleted",d=>$("messages").querySelector('[data-message="'+d.id+'"]')?.remove());socket.on("message:updated",m=>{const n=$("messages").querySelector('[data-message="'+m.id+'"]');if(n){n.childNodes[0].textContent=m.body;}});}}
  function interceptSend(){const form=$("messageForm");if(!form||form.dataset.kikoIntercept)return;form.dataset.kikoIntercept="1";form.addEventListener("submit",async e=>{if(activeGroup){e.preventDefault();e.stopImmediatePropagation();const text=$("messageText").value.trim();if(text&&await sendGroupMessage(text))$("messageText").value="";return;}if(!replyTarget)return;e.preventDefault();e.stopImmediatePropagation();const body=$("messageText").value.trim();if(!body||!activePerson||!socket)return;socket.emit("message:send",{recipientId:activePerson.id,body,reply_to:replyTarget.id},result=>{if(!result?.ok){toast(result?.error||"Не удалось отправить");return;}$("messageText").value="";setReply(null);if(result.message)appendMessage(result.message);});},true);}
  function addSafetyActions(){const menu=$("kikoChatMore");if(!activePerson||!menu)return;const block=$("kikoMenuBlock"),report=$("kikoMenuReport");if(block)block.disabled=false;if(report)report.disabled=false;}
  function bootFeatures(){if(!$("appView")||$("appView").classList.contains("hidden"))return;addFeatureStyles();ensureStories();ensureGroups();ensurePrivacy();ensureChatTools();watchMessages();interceptSend();installTyping();loadStories();loadGroups();loadPrivacy();const originalOpen=window.openChat;if(typeof originalOpen==="function"&&!window.kikoOpenWrapped){window.kikoOpenWrapped=true;window.openChat=async p=>{activeGroup=null;$("messageText").placeholder="Написать сообщение…";await originalOpen(p);addSafetyActions();};}}
  document.addEventListener("DOMContentLoaded",()=>{setTimeout(bootFeatures,700);const obs=new MutationObserver(()=>{if(!$("appView")?.classList.contains("hidden")&&!$("kikoStories"))bootFeatures();});obs.observe(document.body,{childList:true,subtree:true});});
  // Existing app's globals become available after its initial boot.
  setTimeout(()=>{if(typeof socket!=="undefined"&&socket){installTyping();}},1800);
})();
