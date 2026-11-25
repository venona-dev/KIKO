/* KIKO easter eggs — local discoveries */
(() => {
  const KEY="kiko_easter_eggs_v1";
  const defs=[
    {id:"cat",icon:"🐱",name:"Тайный котик",hint:"Найти котика на логотипе"},
    {id:"hearts",icon:"💗",name:"Собиратель сердец",hint:"Собрать 10 сердечек в мини-игре"},
    {id:"cosmos",icon:"🪐",name:"Покоритель космоса",hint:"Открыть секретный космический режим"},
    {id:"midnight",icon:"🌙",name:"Полуночник",hint:"Зайти в KIKO между 00:00 и 00:05"}
  ];
  const $=id=>document.getElementById(id);
  const get=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"{}");}catch{return {};}};
  const save=o=>localStorage.setItem(KEY,JSON.stringify(o));
  let clicks=0,clickTimer=null,holdTimer=null,gameTimer=null,gameScore=0;
  function unlock(id){
    const data=get();if(data[id])return;
    data[id]=new Date().toISOString();save(data);renderCollection();
    const d=defs.find(x=>x.id===id);
    notify("Секрет найден!",d.icon+" "+d.name);
  }
  function notify(title,body){
    let n=$("keToast");if(!n){n=document.createElement("div");n.id="keToast";document.body.append(n);}
    n.innerHTML="";const b=document.createElement("b");b.textContent=title;const s=document.createElement("span");s.textContent=body;n.append(b,s);n.classList.add("show");
    clearTimeout(n._timer);n._timer=setTimeout(()=>n.classList.remove("show"),3200);
  }
  function addStyles(){
    if($("keStyles"))return;const s=document.createElement("style");s.id="keStyles";s.textContent=`
      #keToast{position:fixed;z-index:2147483600;top:18px;left:50%;transform:translate(-50%,-16px);opacity:0;pointer-events:none;background:var(--panel,#fff);color:var(--text,#342632);border:1px solid #edc6d8;border-radius:15px;padding:12px 17px;box-shadow:0 10px 35px #28101d25;display:flex;flex-direction:column;gap:3px;transition:.22s;min-width:190px;text-align:center}#keToast.show{opacity:1;transform:translate(-50%,0)}#keToast span{font-size:12px;opacity:.8}
      .ke-collection{margin-top:14px}.ke-collection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.ke-secret{border:1px solid var(--border,#efdfE7);border-radius:13px;padding:12px;display:flex;gap:10px;align-items:center}.ke-secret.locked{opacity:.48;filter:grayscale(1)}.ke-secret-icon{font-size:25px}.ke-secret b{display:block;font-size:12px}.ke-secret small{font-size:10px;opacity:.7}
      .ke-overlay{position:fixed;inset:0;z-index:2147483500;background:#1c1020a8;display:grid;place-items:center;padding:16px}.ke-game{background:var(--panel,#fff);color:var(--text,#342632);border-radius:20px;padding:20px;width:min(420px,100%);box-shadow:0 20px 70px #0004;text-align:center}.ke-game h2{margin:0 0 6px}.ke-game p{font-size:13px;opacity:.75}.ke-hearts{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:18px 0}.ke-heart{font-size:25px;padding:12px 4px;border:1px solid #f0dce6;background:#fff5f9;border-radius:12px;cursor:pointer}.ke-heart:active{transform:scale(.9)}.ke-game button.close{border:0;border-radius:10px;padding:9px 16px;background:var(--accent,#d66f98);color:white}
      body.ke-cosmos{background:#17132c!important;color:#f7eaff!important}body.ke-cosmos .app-shell,body.ke-cosmos .sidebar,body.ke-cosmos .main,body.ke-cosmos .content{background:transparent!important;color:#f7eaff!important}body.ke-cosmos:before{content:"✦   ·      ✧      ·   ✦     ·      ✧";position:fixed;inset:0;pointer-events:none;z-index:0;color:#e8c8ff;opacity:.35;font-size:28px;letter-spacing:18px;line-height:3;word-break:break-all}body.ke-cosmos .topbar,body.ke-cosmos .post,body.ke-cosmos .composer,body.ke-cosmos .settings-card{background:#29213e!important;color:#fff!important;border-color:#57436f!important}
      @media(max-width:600px){.ke-collection-grid{grid-template-columns:1fr}}
    `;document.head.append(s);
  }
  function renderCollection(){
    const shell=document.querySelector("#accountView .account-shell");if(!shell)return;
    let card=$("keCollection");if(!card){card=document.createElement("section");card.id="keCollection";card.className="settings-card ke-collection";shell.append(card);}
    const found=get(),count=defs.filter(d=>found[d.id]).length;card.replaceChildren();
    const h=document.createElement("h3");h.textContent="🥚 Секреты KIKO";const sub=document.createElement("p");sub.className="muted tiny";sub.textContent=count+" из "+defs.length+" секретов найдено. Некоторые спрятаны очень хорошо…";card.append(h,sub);
    const grid=document.createElement("div");grid.className="ke-collection-grid";
    defs.forEach(d=>{const item=document.createElement("div");item.className="ke-secret"+(found[d.id]?"":" locked");const icon=document.createElement("span");icon.className="ke-secret-icon";icon.textContent=found[d.id]?d.icon:"❔";const copy=document.createElement("div");const name=document.createElement("b");name.textContent=found[d.id]?d.name:"Неизвестный секрет";const hint=document.createElement("small");hint.textContent=found[d.id]?"Открыто":d.hint;copy.append(name,hint);item.append(icon,copy);grid.append(item);});card.append(grid);
  }
  function openGame(){
    if($("keGameOverlay"))return;gameScore=0;let left=20;
    const ov=document.createElement("div");ov.id="keGameOverlay";ov.className="ke-overlay";const box=document.createElement("div");box.className="ke-game";
    const h=document.createElement("h2");h.textContent="Лови сердечки! 💗";const p=document.createElement("p");p.textContent="Нажми на 10 сердечек за 20 секунд. Счёт: 0 · Время: 20";const grid=document.createElement("div");grid.className="ke-hearts";
    for(let i=0;i<15;i++){const b=document.createElement("button");b.className="ke-heart";b.type="button";b.textContent=["💗","💖","💕","💘","💓"][i%5];b.onclick=()=>{if(b.disabled)return;b.disabled=true;b.textContent="✨";gameScore++;p.textContent="Нажми на 10 сердечек за 20 секунд. Счёт: "+gameScore+" · Время: "+left;if(gameScore>=10){clearInterval(gameTimer);unlock("hearts");p.textContent="Ты собрал все сердечки! 💞";}};grid.append(b);}
    const close=document.createElement("button");close.className="close";close.textContent="Закрыть";close.onclick=()=>{clearInterval(gameTimer);ov.remove();};
    box.append(h,p,grid,close);ov.append(box);ov.addEventListener("click",e=>{if(e.target===ov)close.click();});document.body.append(ov);
    gameTimer=setInterval(()=>{left--;if(left<=0){clearInterval(gameTimer);p.textContent=gameScore>=10?"Победа!":"Время вышло! Попробуй ещё раз.";grid.querySelectorAll("button").forEach(b=>b.disabled=true);}else p.textContent="Нажми на 10 сердечек за 20 секунд. Счёт: "+gameScore+" · Время: "+left;},1000);
  }
  function cosmic(){document.body.classList.toggle("ke-cosmos");if(document.body.classList.contains("ke-cosmos")){unlock("cosmos");notify("Секретный режим","Ты нашёл космическую KIKO 🪐 Нажми ту же комбинацию, чтобы вернуться.");}}
  function bindLogo(el){
    if(!el||el.dataset.keBound)return;el.dataset.keBound="1";
    el.addEventListener("click",()=>{clicks++;clearTimeout(clickTimer);clickTimer=setTimeout(()=>clicks=0,1800);if(clicks>=7){clicks=0;unlock("cat");notify("Мяу! 🐱","Ты нашёл тайного котика KIKO!");}});
    el.addEventListener("pointerdown",()=>{holdTimer=setTimeout(openGame,750);});
    ["pointerup","pointerleave","pointercancel"].forEach(ev=>el.addEventListener(ev,()=>clearTimeout(holdTimer)));
  }
  function boot(){
    addStyles();bindLogo(document.querySelector(".brand-small"));bindLogo(document.querySelector(".top-brand"));
    renderCollection();
    const now=new Date();if(now.getHours()===0&&now.getMinutes()<5)unlock("midnight");
    document.querySelectorAll('[data-view="account"]').forEach(b=>b.addEventListener("click",()=>setTimeout(renderCollection,250)));
    let seq=[];const code=["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
    document.addEventListener("keydown",e=>{if(e.target.matches("input,textarea"))return;seq.push(e.key);seq=seq.slice(-code.length);if(seq.length===code.length&&seq.every((v,i)=>v.toLowerCase()===code[i].toLowerCase())){seq=[];cosmic();}});
  }
  document.addEventListener("DOMContentLoaded",boot);
  window.addEventListener("storage",renderCollection);
})();
