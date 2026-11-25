/* KIKO achievements: collection, unlocks and avatar badge */
(() => {
  const $=id=>document.getElementById(id);
  const call=(url,opts={})=>api(url,opts);
  const icons={};
  let current=null;
  function style(){
    if($("kikoAchievementStyles"))return;
    const s=document.createElement("style");s.id="kikoAchievementStyles";s.textContent=`
      .ka-card{background:var(--panel,#fff);border:1px solid #f0dfe8;border-radius:16px;padding:15px;margin:12px 0}
      .ka-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.ka-head h3{margin:0;font-size:15px}
      .ka-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
      .ka-item{display:flex;gap:9px;align-items:center;text-align:left;padding:10px;border:1px solid #f0e2e9;border-radius:12px;background:transparent;color:inherit;min-width:0}
      .ka-item.locked{opacity:.48;filter:grayscale(1)}.ka-icon{font-size:23px;width:30px;text-align:center}.ka-item b{display:block;font-size:11px}.ka-item small{display:block;font-size:10px;opacity:.7;margin-top:3px}
      .ka-item.selected{border-color:var(--accent,#d66f98);box-shadow:0 0 0 1px var(--accent,#d66f98)}
      .ka-badge{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;background:#fff0f6;border:1px solid #edc6d7;font-size:13px;vertical-align:middle;margin-left:5px;box-shadow:0 2px 6px #0001}
      .ka-avatar-wrap{position:relative;display:inline-flex;align-items:center}.ka-avatar-wrap .ka-badge{position:absolute;right:-7px;bottom:-5px;margin:0;width:21px;height:21px;font-size:12px}
      .ka-toast{font-size:12px;padding:8px 10px;background:#fff4f8;border-radius:10px;margin-top:9px;color:#995d78}
      .ka-toast-stack{position:fixed;z-index:2147483000;top:18px;right:18px;width:min(340px,calc(100vw - 28px));display:flex;flex-direction:column;gap:10px;pointer-events:none}
      .ka-unlock-toast{display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid #efc6d8;border-radius:16px;background:var(--panel,#fff);color:var(--text,#302532);box-shadow:0 12px 36px #24101d30;pointer-events:auto;animation:kaToastIn .28s ease-out both}
      .ka-unlock-toast .ka-toast-icon{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border-radius:13px;background:#fff0f6;font-size:25px}
      .ka-unlock-toast strong{display:block;font-size:13px;line-height:1.35}
      .ka-unlock-toast small{display:block;margin-top:3px;font-size:11px;opacity:.72}
      .ka-unlock-toast.leaving{animation:kaToastOut .22s ease-in both}
      @keyframes kaToastIn{from{opacity:0;transform:translateX(18px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}
      @keyframes kaToastOut{to{opacity:0;transform:translateX(18px) scale(.97)}}
      body[data-theme="dark"] .ka-unlock-toast,body[data-theme="midnight"] .ka-unlock-toast{background:#292431;color:#fff;border-color:#514455}
      @media(max-width:600px){.ka-toast-stack{top:12px;right:12px;width:calc(100vw - 24px)}}
      @media(max-width:600px){.ka-grid{grid-template-columns:1fr}}
      body[data-theme="dark"] .ka-card,body[data-theme="midnight"] .ka-card{background:#292431;border-color:#453b4a}
      body[data-theme="dark"] .ka-item,body[data-theme="midnight"] .ka-item{border-color:#514455}
    `;document.head.append(s);
  }
  async function refresh(){
    try{current=await call("/api/achievements");render();}catch(e){console.warn("Achievements unavailable",e);}
  }
  function render(){
    if(!current)return;
    const root=$("kikoAchievements");if(root){
      root.replaceChildren();
      const head=document.createElement("div");head.className="ka-head";
      const h=document.createElement("h3");h.textContent="Достижения";
      const count=document.createElement("small");count.textContent=current.achievements.filter(x=>x.unlocked).length+" / "+current.achievements.length+" открыто";
      head.append(h,count);root.append(head);
      const hint=document.createElement("p");hint.className="feature-muted";hint.textContent="Выполняй действия в KIKO, собирай значки и выбери один для аватарки.";root.append(hint);
      const grid=document.createElement("div");grid.className="ka-grid";
      current.achievements.forEach(a=>{
        const b=document.createElement("button");b.type="button";b.className="ka-item"+(!a.unlocked?" locked":"")+(current.featured===a.key?" selected":"");
        const ico=document.createElement("span");ico.className="ka-icon";ico.textContent=a.icon;
        const copy=document.createElement("span");const title=document.createElement("b");title.textContent=a.title;
        const desc=document.createElement("small");desc.textContent=a.unlocked?"Получено · "+new Date(a.unlocked_at).toLocaleDateString("ru-RU"):a.description;
        copy.append(title,desc);b.append(ico,copy);
        b.disabled=!a.unlocked;b.title=a.unlocked?"Показать значок около аватарки":a.description;
        b.onclick=()=>select(a.key);grid.append(b);
      });
      root.append(grid);
      const clear=document.createElement("button");clear.type="button";clear.className="feature-btn";clear.textContent="Убрать значок с аватарки";clear.onclick=()=>select(null);root.append(clear);
    }
    paintBadges();
  }
  function paintBadges(){
    document.querySelectorAll(".ka-badge").forEach(n=>n.remove());
    const selected=current?.achievements.find(a=>a.key===current.featured&&a.unlocked);if(!selected)return;
    ["myAvatar","postAvatar","profileAvatarPreview"].forEach(id=>{
      const el=$(id);if(!el||!el.parentNode)return;
      const badge=document.createElement("span");badge.className="ka-badge";badge.textContent=selected.icon;badge.title=selected.title;
      if(id==="profileAvatarPreview"){el.classList.add("ka-avatar-wrap");el.append(badge);}
      else {el.classList.add("ka-avatar-wrap");el.append(badge);}
    });
    const hero=$("profileName");if(hero&&!hero.querySelector(".ka-name-badge")){const b=document.createElement("span");b.className="ka-badge ka-name-badge";b.textContent=selected.icon;b.title=selected.title;hero.append(b);}
  }
  async function select(key){
    try{await call("/api/achievements/featured",{method:"PUT",body:JSON.stringify({key})});current.featured=key;render();toast(key?"Значок отображается около аватарки":"Значок скрыт");}
    catch(e){toast(e.message);}
  }
  let toastQueue=[];let toastBusy=false;
  function achievementToast(a){
    toastQueue.push(a);
    if(toastBusy)return;
    toastBusy=true;
    const showNext=()=>{
      const item=toastQueue.shift();
      if(!item){toastBusy=false;return;}
      let stack=document.getElementById("kaToastStack");
      if(!stack){stack=document.createElement("div");stack.id="kaToastStack";stack.className="ka-toast-stack";stack.setAttribute("aria-live","polite");stack.setAttribute("aria-atomic","false");document.body.append(stack);}
      const node=document.createElement("div");node.className="ka-unlock-toast";node.setAttribute("role","status");
      const icon=document.createElement("span");icon.className="ka-toast-icon";icon.textContent=item.icon||"🏆";
      const copy=document.createElement("span");const title=document.createElement("strong");title.textContent="Достижение получено!";
      const name=document.createElement("small");name.textContent=(item.title||"Новое достижение")+" · Поздравляем!";
      copy.append(title,name);node.append(icon,copy);stack.append(node);
      window.setTimeout(()=>{node.classList.add("leaving");window.setTimeout(()=>{node.remove();showNext();},240);},4600);
    };
    showNext();
  }
  async function track(event){
    if(!event)return;
    try{const r=await call("/api/achievements/track",{method:"POST",body:JSON.stringify({event})});
      if(r.newly?.length){await refresh();r.newly.forEach(achievementToast);}
    }catch(e){console.warn("Achievement tracking failed",e);}
  }
  window.kikoAchievementTrack=track;
  function install(){
    style();
    const account=$("accountView");
    if(account&&!$("kikoAchievements")){const card=document.createElement("section");card.id="kikoAchievements";card.className="ka-card";const settings=account.querySelector(".account-shell");if(settings)settings.append(card);}
    const logo=document.querySelector(".brand-small");
    if(logo&&!logo.dataset.achievementClick){logo.dataset.achievementClick="1";logo.style.cursor="pointer";logo.title="Нажми, чтобы получить достижение";logo.addEventListener("click",()=>track("logo_click"));}
    if(current)render();
  }
  document.addEventListener("DOMContentLoaded",()=>{install();refresh();});
  document.addEventListener("kiko:avatar-painted",paintBadges);
  document.addEventListener("kiko:achievement-refresh",refresh);
})();
