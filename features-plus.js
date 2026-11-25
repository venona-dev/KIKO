module.exports = function installKikoPlus({ app, io, pool, auth }) {
  const safe = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(err => {
    console.error("KIKO Plus error", err);
    if (!res.headersSent) res.status(500).json({ error: "Ошибка сервера" });
  });
  const tables = () => pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body VARCHAR(4000) NOT NULL,
      send_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx ON scheduled_messages(send_at);
    CREATE TABLE IF NOT EXISTS polls (
      id BIGSERIAL PRIMARY KEY,
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question VARCHAR(300) NOT NULL,
      options JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closes_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(poll_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS poll_votes_poll_idx ON poll_votes(poll_id);
  `);
  app.get("/api/plus/scheduled", auth, safe(async (req,res) => {
    const r = await pool.query("SELECT id,recipient_id,body,send_at FROM scheduled_messages WHERE sender_id=$1 ORDER BY send_at LIMIT 100",[req.user.id]);
    res.json(r.rows);
  }));
  app.post("/api/plus/scheduled", auth, safe(async (req,res) => {
    const recipient=Number(req.body.recipient_id), body=String(req.body.body||"").trim(), at=new Date(req.body.send_at);
    if(!Number.isInteger(recipient)||recipient<1||recipient===req.user.id||!body||body.length>4000||!Number.isFinite(at.getTime()))
      return res.status(400).json({error:"Проверь получателя, текст и время отправки"});
    if(at.getTime()<Date.now()+60000||at.getTime()>Date.now()+30*24*60*60*1000)
      return res.status(400).json({error:"Отправку можно запланировать от 1 минуты до 30 дней"});
    const blocked=await pool.query("SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[req.user.id,recipient]);
    if(blocked.rowCount)return res.status(403).json({error:"Нельзя отправить сообщение этому пользователю"});
    const target=await pool.query("SELECT id FROM users WHERE id=$1",[recipient]);
    if(!target.rowCount)return res.status(404).json({error:"Пользователь не найден"});
    const r=await pool.query("INSERT INTO scheduled_messages(sender_id,recipient_id,body,send_at) VALUES($1,$2,$3,$4) RETURNING id,recipient_id,body,send_at",[req.user.id,recipient,body,at.toISOString()]);
    res.status(201).json(r.rows[0]);
  }));
  app.delete("/api/plus/scheduled/:id", auth, safe(async (req,res) => {
    const r=await pool.query("DELETE FROM scheduled_messages WHERE id=$1 AND sender_id=$2 RETURNING id",[Number(req.params.id),req.user.id]);
    if(!r.rowCount)return res.status(404).json({error:"Запланированное сообщение не найдено"});
    res.json({ok:true});
  }));
  app.get("/api/plus/polls", auth, safe(async (req,res) => {
    const r=await pool.query(`SELECT p.id,p.creator_id,p.question,p.options,p.created_at,p.closes_at,u.username,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('option_index',v.option_index,'votes',v.votes) ORDER BY v.option_index)
        FROM (SELECT option_index,COUNT(*)::int votes FROM poll_votes WHERE poll_id=p.id GROUP BY option_index) v),'[]'::jsonb) AS results,
      (SELECT option_index FROM poll_votes WHERE poll_id=p.id AND user_id=$1) AS my_vote
      FROM polls p JOIN users u ON u.id=p.creator_id ORDER BY p.created_at DESC LIMIT 50`,[req.user.id]);
    res.json(r.rows);
  }));
  app.post("/api/plus/polls", auth, safe(async (req,res) => {
    const question=String(req.body.question||"").trim(), options=Array.isArray(req.body.options)?req.body.options.map(x=>String(x).trim()).filter(Boolean):[];
    if(!question||question.length>300||options.length<2||options.length>8||options.some(x=>x.length>80)||new Set(options).size!==options.length)
      return res.status(400).json({error:"Нужен вопрос и от 2 до 8 разных вариантов (до 80 символов)"});
    const r=await pool.query("INSERT INTO polls(creator_id,question,options) VALUES($1,$2,$3::jsonb) RETURNING id,creator_id,question,options,created_at,closes_at",[req.user.id,question,JSON.stringify(options)]);
    const poll={...r.rows[0],username:req.user.username,results:[],my_vote:null};io.emit("poll:new",poll);res.status(201).json(poll);
  }));
  app.post("/api/plus/polls/:id/vote", auth, safe(async (req,res) => {
    const id=Number(req.params.id), index=Number(req.body.option_index);
    const poll=await pool.query("SELECT options,closes_at FROM polls WHERE id=$1",[id]);
    if(!poll.rowCount)return res.status(404).json({error:"Опрос не найден"});
    if(!Number.isInteger(index)||index<0||index>=poll.rows[0].options.length)return res.status(400).json({error:"Такого варианта нет"});
    if(poll.rows[0].closes_at&&new Date(poll.rows[0].closes_at).getTime()<=Date.now())return res.status(409).json({error:"Опрос завершён"});
    await pool.query("INSERT INTO poll_votes(poll_id,user_id,option_index) VALUES($1,$2,$3) ON CONFLICT(poll_id,user_id) DO UPDATE SET option_index=EXCLUDED.option_index,created_at=NOW()",[id,req.user.id,index]);
    const counts=await pool.query("SELECT option_index,COUNT(*)::int AS votes FROM poll_votes WHERE poll_id=$1 GROUP BY option_index ORDER BY option_index",[id]);
    res.json({poll_id:id,results:counts.rows,my_vote:index});
  }));
  let processing=false;
  const deliver=async()=>{
    if(processing)return;processing=true;
    try {
      const c=await pool.connect();
      try {
        await c.query("BEGIN");
        const due=await c.query("SELECT * FROM scheduled_messages WHERE send_at<=NOW() ORDER BY send_at FOR UPDATE SKIP LOCKED LIMIT 50");
        for(const m of due.rows){
          const blocked=await c.query("SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[m.sender_id,m.recipient_id]);
          if(!blocked.rowCount){
            const u=await c.query("SELECT username FROM users WHERE id=$1",[m.sender_id]);
            const inserted=await c.query("INSERT INTO messages(sender_id,recipient_id,body,message_type) VALUES($1,$2,$3,'text') RETURNING id,sender_id,recipient_id,body,message_type,created_at",[m.sender_id,m.recipient_id,m.body]);
            const msg={...inserted.rows[0],sender_name:u.rows[0]?.username||"KIKO"};
            io.to("user:"+m.sender_id).to("user:"+m.recipient_id).emit("message:new",msg);
          }
          await c.query("DELETE FROM scheduled_messages WHERE id=$1",[m.id]);
        }
        await c.query("COMMIT");
      } catch(e){await c.query("ROLLBACK");throw e;} finally{c.release();}
    } catch(e){console.error("Scheduled message delivery failed",e);} finally{processing=false;}
  };
  const timer=setInterval(deliver,15000); if(timer.unref)timer.unref();
  return tables();
};
