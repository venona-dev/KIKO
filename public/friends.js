/* KIKO profiles and friends */
(() => {
  const $=id=>document.getElementById(id);
  const btn=(label)=>{const b=document.createElement("button");b.type="button";b.className="kf-btn";b.textContent=label;return b;};
  function styles(){if($("kikoFriendsStyles"))return;const s=document.createElement("style");s.id="kikoFriendsStyles";s.textContent=`
    .kf-btn{border:1px solid #efd6e2;background:#fff3f8;color:#a65378;border-radius:9px;padding:6px 9px;font-size:11px;cursor:pointer}
    .kf-person-actions{display:flex;gap:5px;margin-left:auto;align-items:center}.person{display:flex;align-items:center;gap:9px}
    .kf-panel{padding:10px;margin:10px 0;border:1px solid #f0dfe8;border-radius:12px;font-size:12px}
    .kf-panel h4{margin:0 0 8px;font-size:12px}.kf-row{display:flex;align-items:center;gap:8px;padding:6px 0}.kf-row span{flex:1}
    .kf-profile-head{display:flex;gap:14px;align-items:center}.kf-avatar{width:62px;height:62px;border-radius:50%;object-fit:cover;background:#f9e8f0;display:grid;place-items:center;font-size:24px;color:#a65378}
    .kf-post{border-top:1px solid #f1e4ea;padding:10px 0;font-size:12px;white-space:pre-wrap}.kf-meta{font-size:10px;opacity:.65;margin-top:5px}
    body[data-theme="dark"] .kf-panel,body[data-theme="midnight"] .kf-panel{border-color:#514455}
  `;document.head.append(s);}
  async function profile(id){
    try{
      const p=await api("/api/users/"+id+"/profile");
      const wrap=document.createElement("div");
      const head=document.createElement("div");head.className="kf-profile-head";
      const av=document.createElement(p.avatar_data?"img":"div");av.className="kf-avatar";
      if(p.avatar_data)av.src=p.avatar_data;else av.textContent=(p.username||"?").slice(0,1).toUpperCase();
      const info=document.createElement("div");const name=document.createElement("h2");name.textContent=p.username;const status=document.createElement("p");status.textContent=p.status||"Пока без статуса";info.append(name,status);head.append(av,info);wrap.append(head);
      const actions=document.createElement("div");actions.className="feature-row";actions.style.margin="14px 0";
      if(p.friend_status==="none"){const add=btn("＋ Добавить в друзья");add.onclick=async()=>{try{await api("/api/friends/request/"+p.id,{method:"POST"});add.textContent="Запрос отправлен";add.disabled=true;}catch(e){toast(e.message);}};actions.append(add);}
      else if(p.friend_status==="sent"){const sent=btn("Запрос отправлен");sent.disabled=true;actions.append(sent);}
      else if(p.friend_status==="received"){const accept=btn("Принять запрос");accept.onclick=async()=>{try{const reqs=await api("/api/friends/requests");const r=reqs.find(x=>x.sender_id===p.id);if(!r)throw Error("Запрос уже недоступен");await api("/api/friends/requests/"+r.id+"/accept",{method:"POST"});toast("Теперь вы друзья!");document.querySelector(".feature-overlay")?.remove();loadFriends();}catch(e){toast(e.message);}};actions.append(accept);}
      else if(p.friend_status==="friends"){const yes=btn("✓ Вы друзья");yes.disabled=true;actions.append(yes);}
      const chat=btn("Написать");chat.onclick=()=>{document.querySelector(".feature-overlay")?.remove();document.querySelector('[data-view="chats"]')?.click();const search=$("userSearch");if(search){search.value=p.username;search.dispatchEvent(new Event("input"));setTimeout(()=>{const row=[...$("peopleList").querySelectorAll(".person")].find(x=>x.textContent.includes(p.username));row?.click();},250);}};actions.append(chat);wrap.append(actions);
      const h=document.createElement("h3");h.textContent="Публикации";wrap.append(h);
      if(!p.posts?.length){const empty=document.createElement("p");empty.textContent="Пока нет публикаций";wrap.append(empty);}
      (p.posts||[]).forEach(post=>{const card=document.createElement("div");card.className="kf-post";const body=document.createElement("div");body.textContent=post.body;const meta=document.createElement("div");meta.className="kf-meta";meta.textContent=new Date(post.created_at).toLocaleString("ru-RU")+" · ♥ "+post.likes+" · комментариев: "+post.comments_count;card.append(body,meta);wrap.append(card);});
      dialog("Профиль пользователя",wrap);
    }catch(e){toast(e.message);}
  }
  function dialog(title,content){const ov=document.createElement("div");ov.className="feature-overlay";const box=document.createElement("div");box.className="feature-dialog";const h=document.createElement("h3");h.textContent=title;box.append(h,content);const close=btn("Закрыть");close.onclick=()=>ov.remove();box.append(close);ov.append(box);ov.onclick=e=>{if(e.target===ov)ov.remove();};document.body.append(ov);}
  async function loadFriends(){
    if(!$("peopleList"))return;
    let panel=$("kikoFriendsPanel");if(!panel){panel=document.createElement("section");panel.id="kikoFriendsPanel";panel.className="kf-panel";$("peopleList").after(panel);}
    try{
      const [friends,requests]=await Promise.all([api("/api/friends"),api("/api/friends/requests")]);panel.replaceChildren();
      const h=document.createElement("h4");h.textContent="ДРУЗЬЯ · "+friends.length;panel.append(h);
      friends.forEach(f=>{const row=document.createElement("div");row.className="kf-row";const n=document.createElement("span");n.textContent=f.username;const p=btn("Профиль");p.onclick=()=>profile(f.id);const chat=btn("Написать");chat.onclick=()=>{document.querySelector('[data-view="chats"]')?.click();const s=$("userSearch");s.value=f.username;s.dispatchEvent(new Event("input"));setTimeout(()=>[...$("peopleList").querySelectorAll(".person")].find(x=>x.textContent.includes(f.username))?.click(),250);};row.append(n,p,chat);panel.append(row);});
      const rh=document.createElement("h4");rh.textContent="ЗАПРОСЫ В ДРУЗЬЯ · "+requests.length;rh.style.marginTop="12px";panel.append(rh);
      if(!requests.length){const none=document.createElement("small");none.textContent="Новых запросов нет";panel.append(none);}
      requests.forEach(r=>{const row=document.createElement("div");row.className="kf-row";const n=document.createElement("span");n.textContent=r.username;const p=btn("Профиль");p.onclick=()=>profile(r.sender_id);const accept=btn("Принять");accept.onclick=async()=>{try{await api("/api/friends/requests/"+r.id+"/accept",{method:"POST"});toast("Добавлено в друзья");loadFriends();}catch(e){toast(e.message);}};row.append(n,p,accept);panel.append(row);});
    }catch(e){console.warn("Friends unavailable",e);}
  }
  function decoratePeople(){
    $("peopleList")?.querySelectorAll(".person").forEach(row=>{
      if(row.querySelector(".kf-person-actions"))return;
      const name=row.querySelector("b")?.textContent;if(!name)return;
      const actions=document.createElement("span");actions.className="kf-person-actions";
      const p=btn("Профиль");p.onclick=e=>{e.stopPropagation();const id=[...(window.__kikoPeople||[])].find(x=>x.username===name)?.id;if(id)profile(id);else api("/api/users?q="+encodeURIComponent(name)).then(r=>{const u=r.find(x=>x.username===name);if(u)profile(u.id);});};
      actions.append(p);row.append(actions);
    });
  }
  function boot(){styles();loadFriends();decoratePeople();}
  document.addEventListener("DOMContentLoaded",()=>{setTimeout(boot,600);const root=$("peopleList");if(root)new MutationObserver(decoratePeople).observe(root,{childList:true,subtree:true});document.querySelector('[data-view="chats"]')?.addEventListener("click",()=>setTimeout(loadFriends,300));});
  window.addEventListener("focus",loadFriends);
  document.addEventListener("kiko:friends-refresh",loadFriends);
})();
