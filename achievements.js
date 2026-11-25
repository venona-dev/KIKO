module.exports = function installKikoAchievements({ app, pool, auth }) {
  const safe = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(err => {
    console.error("KIKO achievements error", err);
    if (!res.headersSent) res.status(500).json({ error: "Не удалось загрузить достижения" });
  });
  const definitions = [
    ["logo_click","Знакомство","Нажми на логотип KIKO","✿","logo_click",1],
    ["first_message","Первый диалог","Отправь своё первое сообщение","💬","message_sent",1],
    ["messages_10","На связи","Отправь 10 сообщений","✨","message_sent",10],
    ["messages_100","Душа компании","Отправь 100 сообщений","💖","message_sent",100],
    ["first_post","Своя история","Опубликуй первый пост на стене","📝","post_created",1],
    ["first_like","Сердечко","Поставь лайк публикации","❤️","post_liked",1],
    ["first_comment","Обсудим?","Оставь первый комментарий","🗨️","comment_created",1],
    ["first_story","Момент дня","Опубликуй первую историю","🌸","story_created",1],
    ["first_group","Своя команда","Создай первую группу","👥","group_created",1],
    ["first_call","На проводе","Совершите первый звонок","☎️","call_started",1]
  ];
  const tables = () => pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS featured_achievement VARCHAR(40);
    CREATE TABLE IF NOT EXISTS achievement_events (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_key VARCHAR(40) NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id,event_key)
    );
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_key VARCHAR(40) NOT NULL,
      unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id,achievement_key)
    );
  `);
  app.get("/api/achievements", auth, safe(async (req,res) => {
    const [unlocked, featured] = await Promise.all([
      pool.query("SELECT achievement_key,unlocked_at FROM user_achievements WHERE user_id=$1",[req.user.id]),
      pool.query("SELECT featured_achievement FROM users WHERE id=$1",[req.user.id])
    ]);
    const have = new Map(unlocked.rows.map(x=>[x.achievement_key,x.unlocked_at]));
    res.json({ featured: featured.rows[0]?.featured_achievement || null,
      achievements: definitions.map(([key,title,description,icon])=>({key,title,description,icon,unlocked:have.has(key),unlocked_at:have.get(key)||null})) });
  }));
  app.post("/api/achievements/track", auth, safe(async (req,res) => {
    const event = String(req.body.event || "");
    const allowed = new Set(definitions.map(x=>x[4]));
    if (!allowed.has(event)) return res.status(400).json({error:"Неизвестное действие"});
    const counter = await pool.query(`INSERT INTO achievement_events(user_id,event_key,event_count)
      VALUES($1,$2,1) ON CONFLICT(user_id,event_key)
      DO UPDATE SET event_count=achievement_events.event_count+1,updated_at=NOW()
      RETURNING event_count`,[req.user.id,event]);
    const count = Number(counter.rows[0].event_count);
    const newly = [];
    for (const [key,title,description,icon,eventKey,threshold] of definitions) {
      if (eventKey===event && count>=threshold) {
        const r=await pool.query("INSERT INTO user_achievements(user_id,achievement_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING achievement_key",[req.user.id,key]);
        if(r.rowCount)newly.push({key,title,description,icon});
      }
    }
    res.json({ok:true,newly});
  }));
  app.put("/api/achievements/featured", auth, safe(async (req,res) => {
    const key=req.body.key===null||req.body.key===""?null:String(req.body.key);
    if(key!==null) {
      if(!definitions.some(x=>x[0]===key))return res.status(400).json({error:"Такого достижения нет"});
      const owned=await pool.query("SELECT 1 FROM user_achievements WHERE user_id=$1 AND achievement_key=$2",[req.user.id,key]);
      if(!owned.rowCount)return res.status(403).json({error:"Сначала получи это достижение"});
    }
    await pool.query("UPDATE users SET featured_achievement=$2 WHERE id=$1",[req.user.id,key]);
    res.json({ok:true,featured:key});
  }));
  return tables();
};
