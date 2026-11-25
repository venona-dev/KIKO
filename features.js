module.exports = function installKikoFeatures({ app, io, pool, auth }) {
  const safe = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(err => {
    console.error("KIKO feature error", err); if (!res.headersSent) res.status(500).json({error:"Ошибка сервера"});
  });
  const pairAccess = async (messageId, userId) => {
    const r = await pool.query("SELECT * FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)",[messageId,userId]);
    return r.rows[0] || null;
  };
  const featureTables = async () => pool.query(`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_data BYTEA;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(180);
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(100);
    CREATE TABLE IF NOT EXISTS groups_chat(id SERIAL PRIMARY KEY,name VARCHAR(60) NOT NULL,description VARCHAR(240) NOT NULL DEFAULT '',avatar_data TEXT,created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS group_members(group_id INTEGER NOT NULL REFERENCES groups_chat(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,role VARCHAR(12) NOT NULL DEFAULT 'member',joined_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(group_id,user_id));
    CREATE TABLE IF NOT EXISTS group_messages(id SERIAL PRIMARY KEY,group_id INTEGER NOT NULL REFERENCES groups_chat(id) ON DELETE CASCADE,sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body VARCHAR(4000) NOT NULL DEFAULT '',attachment_data BYTEA,attachment_name VARCHAR(180),attachment_mime VARCHAR(100),reply_to INTEGER REFERENCES group_messages(id) ON DELETE SET NULL,edited_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,pinned BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS group_messages_idx ON group_messages(group_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS stories(id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body VARCHAR(500) NOT NULL DEFAULT '',media_data TEXT,media_mime VARCHAR(100),created_at TIMESTAMPTZ DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours');
    CREATE TABLE IF NOT EXISTS user_friends (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id,friend_id),
      CHECK(user_id<>friend_id)
    );
    CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(sender_id,recipient_id),
      CHECK(sender_id<>recipient_id)
    );
    CREATE INDEX IF NOT EXISTS friend_requests_recipient_idx ON friend_requests(recipient_id,status,created_at DESC);
    CREATE TABLE IF NOT EXISTS user_blocks(blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id<>blocked_id));
    CREATE TABLE IF NOT EXISTS user_reports(id SERIAL PRIMARY KEY,reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason VARCHAR(500) NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS user_privacy(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_seen VARCHAR(12) NOT NULL DEFAULT 'everyone',profile_visibility VARCHAR(12) NOT NULL DEFAULT 'everyone',read_receipts BOOLEAN NOT NULL DEFAULT TRUE,typing_status BOOLEAN NOT NULL DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS chat_settings(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,other_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,theme VARCHAR(16) NOT NULL DEFAULT 'default',wallpaper VARCHAR(16) NOT NULL DEFAULT 'default',muted BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(user_id,other_user_id));
  `);
  app.get("/api/features/privacy",auth,safe(async(req,res)=>{
    await pool.query("INSERT INTO user_privacy(user_id) VALUES($1) ON CONFLICT DO NOTHING",[req.user.id]);
    const r=await pool.query("SELECT last_seen,profile_visibility,read_receipts,typing_status FROM user_privacy WHERE user_id=$1",[req.user.id]);res.json(r.rows[0]);
  }));
  app.put("/api/features/privacy",auth,safe(async(req,res)=>{
    const b=req.body||{},last=["everyone","contacts","nobody"].includes(b.last_seen)?b.last_seen:"everyone",profile=["everyone","contacts","nobody"].includes(b.profile_visibility)?b.profile_visibility:"everyone";
    const r=await pool.query(`INSERT INTO user_privacy(user_id,last_seen,profile_visibility,read_receipts,typing_status) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(user_id) DO UPDATE SET last_seen=EXCLUDED.last_seen,profile_visibility=EXCLUDED.profile_visibility,read_receipts=EXCLUDED.read_receipts,typing_status=EXCLUDED.typing_status
      RETURNING last_seen,profile_visibility,read_receipts,typing_status`,[req.user.id,last,profile,b.read_receipts!==false,b.typing_status!==false]);res.json(r.rows[0]);
  }));
  app.get("/api/features/stories",auth,safe(async(req,res)=>{
    const r=await pool.query(`SELECT s.id,s.user_id,u.username,s.body,s.media_data,s.media_mime,s.created_at,s.expires_at
      FROM stories s JOIN users u ON u.id=s.user_id WHERE s.expires_at>NOW()
      AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=s.user_id) OR (b.blocker_id=s.user_id AND b.blocked_id=$1))
      ORDER BY s.created_at DESC LIMIT 100`,[req.user.id]);res.json(r.rows);
  }));
  app.post("/api/features/stories",auth,safe(async(req,res)=>{
    const body=String(req.body.body||"").slice(0,500),media=String(req.body.media_data||""),mime=String(req.body.media_mime||"");
    if(!body&&!media)return res.status(400).json({error:"Добавь текст или изображение"});
    if(media&&(!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(media)||media.length>2400000))return res.status(400).json({error:"Изображение должно быть JPG, PNG, GIF или WebP до 1,8 МБ"});
    const r=await pool.query("INSERT INTO stories(user_id,body,media_data,media_mime) VALUES($1,$2,$3,$4) RETURNING *",[req.user.id,body,media||null,mime||null]);const story={...r.rows[0],username:req.user.username};io.emit("story:new",story);res.status(201).json(story);
  }));
  app.delete("/api/features/stories/:id",auth,safe(async(req,res)=>{
    const r=await pool.query("DELETE FROM stories WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"История не найдена"});res.json({ok:true});
  }));
  app.get("/api/features/search",auth,safe(async(req,res)=>{
    const q=String(req.query.q||"").trim().slice(0,100),other=Number(req.query.userId);if(q.length<2)return res.json([]);
    const r=await pool.query(`SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at,u.username AS sender_name
      FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE ((m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1))
      AND m.deleted_at IS NULL AND m.body ILIKE $3 ORDER BY m.created_at DESC LIMIT 50`,[req.user.id,other,"%"+q+"%"]);res.json(r.rows);
  }));
  app.patch("/api/features/messages/:id",auth,safe(async(req,res)=>{
    const id=Number(req.params.id),body=String(req.body.body||"").trim();if(!body||body.length>4000)return res.status(400).json({error:"Текст должен содержать 1–4000 символов"});
    const r=await pool.query("UPDATE messages SET body=$3,edited_at=NOW() WHERE id=$1 AND sender_id=$2 AND deleted_at IS NULL RETURNING id,sender_id,recipient_id,body,edited_at,created_at",[id,req.user.id,body]);
    if(!r.rowCount)return res.status(404).json({error:"Сообщение нельзя изменить"});const m=r.rows[0];io.to("user:"+m.sender_id).to("user:"+m.recipient_id).emit("message:updated",m);res.json(m);
  }));
  app.delete("/api/features/messages/:id",auth,safe(async(req,res)=>{
    const id=Number(req.params.id),mode=req.query.mode==="everyone"?"everyone":"self";
    const m=await pairAccess(id,req.user.id);if(!m)return res.status(404).json({error:"Сообщение не найдено"});
    if(mode==="everyone"){if(m.sender_id!==req.user.id)return res.status(403).json({error:"Удалить у всех может только автор"});await pool.query("UPDATE messages SET deleted_at=NOW(),body='Сообщение удалено',attachment_data=NULL,attachment_name=NULL WHERE id=$1",[id]);}
    else await pool.query("DELETE FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)",[id,req.user.id]);
    io.to("user:"+m.sender_id).to("user:"+m.recipient_id).emit("message:deleted",{id,mode});res.json({ok:true});
  }));
  app.post("/api/features/messages/:id/pin",auth,safe(async(req,res)=>{
    const m=await pairAccess(Number(req.params.id),req.user.id);if(!m)return res.status(404).json({error:"Сообщение не найдено"});
    const pinned=!!req.body.pinned;await pool.query("UPDATE messages SET pinned=$2 WHERE id=$1",[m.id,pinned]);const data={id:m.id,pinned};io.to("user:"+m.sender_id).to("user:"+m.recipient_id).emit("message:pinned",data);res.json(data);
  }));
  app.post("/api/features/messages/:userId/attachment",auth,safe(async(req,res)=>{
    const recipient=Number(req.params.userId),name=String(req.body.name||"file").replace(/[\\/]/g,"_").slice(0,180),mime=String(req.body.mime||"application/octet-stream").slice(0,100),base64=String(req.body.data||"");
    if(!Number.isInteger(recipient)||recipient<1||recipient===req.user.id)return res.status(400).json({error:"Некорректный собеседник"});
    if(!base64||base64.length>7*1024*1024)return res.status(413).json({error:"Файл слишком большой (максимум 5 МБ)"});
    const data=Buffer.from(base64,"base64");if(!data.length||data.length>5*1024*1024)return res.status(413).json({error:"Файл слишком большой"});
    const target=await pool.query("SELECT id FROM users WHERE id=$1",[recipient]);if(!target.rowCount)return res.status(404).json({error:"Пользователь не найден"});
    const r=await pool.query(`INSERT INTO messages(sender_id,recipient_id,body,message_type,attachment_data,attachment_name,attachment_mime)
      VALUES($1,$2,$3,'file',$4,$5,$6) RETURNING id,sender_id,recipient_id,body,message_type,attachment_name,attachment_mime,created_at`,[req.user.id,recipient,name,data,name,mime]);
    const message={...r.rows[0],sender_name:req.user.username};io.to("user:"+recipient).to("user:"+req.user.id).emit("message:new",message);res.status(201).json(message);
  }));
  app.get("/api/features/messages/:id/download",auth,safe(async(req,res)=>{
    const m=await pairAccess(Number(req.params.id),req.user.id);if(!m||!m.attachment_data)return res.status(404).json({error:"Файл не найден"});
    res.setHeader("Content-Type",m.attachment_mime||"application/octet-stream");res.setHeader("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(m.attachment_name||"download"));res.send(m.attachment_data);
  }));
  app.get("/api/features/chats/:userId/settings",auth,safe(async(req,res)=>{
    const other=Number(req.params.userId);const r=await pool.query("SELECT theme,wallpaper,muted FROM chat_settings WHERE user_id=$1 AND other_user_id=$2",[req.user.id,other]);res.json(r.rows[0]||{theme:"default",wallpaper:"default",muted:false});
  }));
  app.put("/api/features/chats/:userId/settings",auth,safe(async(req,res)=>{
    const other=Number(req.params.userId),theme=["default","pink","lavender","midnight"].includes(req.body.theme)?req.body.theme:"default",wallpaper=["default","gradient","stars","plain"].includes(req.body.wallpaper)?req.body.wallpaper:"default";
    const r=await pool.query(`INSERT INTO chat_settings(user_id,other_user_id,theme,wallpaper,muted) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(user_id,other_user_id) DO UPDATE SET theme=EXCLUDED.theme,wallpaper=EXCLUDED.wallpaper,muted=EXCLUDED.muted RETURNING theme,wallpaper,muted`,[req.user.id,other,theme,wallpaper,!!req.body.muted]);res.json(r.rows[0]);
  }));
  app.post("/api/features/block/:userId",auth,safe(async(req,res)=>{
    const id=Number(req.params.userId);if(!id||id===req.user.id)return res.status(400).json({error:"Некорректный пользователь"});
    await pool.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.user.id,id]);res.json({ok:true});
  }));
  app.delete("/api/features/block/:userId",auth,safe(async(req,res)=>{await pool.query("DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2",[req.user.id,Number(req.params.userId)]);res.json({ok:true});}));
  app.post("/api/features/report/:userId",auth,safe(async(req,res)=>{
    const id=Number(req.params.userId),reason=String(req.body.reason||"").trim().slice(0,500);if(!id||id===req.user.id||!reason)return res.status(400).json({error:"Укажи причину жалобы"});
    await pool.query("INSERT INTO user_reports(reporter_id,reported_id,reason) VALUES($1,$2,$3)",[req.user.id,id,reason]);res.status(201).json({ok:true});
  }));
  app.get("/api/friends",auth,safe(async(req,res)=>{
    const r=await pool.query(`SELECT u.id,u.username,u.status,u.avatar_data,uf.created_at AS friend_since
      FROM user_friends uf JOIN users u ON u.id=uf.friend_id WHERE uf.user_id=$1 ORDER BY u.username`,[req.user.id]);res.json(r.rows);
  }));
  app.get("/api/friends/requests",auth,safe(async(req,res)=>{
    const r=await pool.query(`SELECT fr.id,fr.sender_id,fr.recipient_id,fr.created_at,u.username,u.status AS user_status,u.avatar_data
      FROM friend_requests fr JOIN users u ON u.id=fr.sender_id
      WHERE fr.recipient_id=$1 AND fr.status='pending' ORDER BY fr.created_at DESC`,[req.user.id]);res.json(r.rows);
  }));
  app.get("/api/users/:id/profile",auth,safe(async(req,res)=>{
    const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Некорректный пользователь"});
    const user=await pool.query("SELECT id,username,status,avatar_data,created_at FROM users WHERE id=$1",[id]);if(!user.rowCount)return res.status(404).json({error:"Пользователь не найден"});
    if(id===req.user.id)return res.json({...user.rows[0],is_me:true,friend_status:"self",posts:[]});
    const blocked=await pool.query("SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[req.user.id,id]);if(blocked.rowCount)return res.status(404).json({error:"Профиль недоступен"});
    const friendship=await pool.query("SELECT 1 FROM user_friends WHERE user_id=$1 AND friend_id=$2",[req.user.id,id]);
    const privacy=await pool.query("SELECT profile_visibility FROM user_privacy WHERE user_id=$1",[id]);
    if(privacy.rows[0]?.profile_visibility==="nobody"||(privacy.rows[0]?.profile_visibility==="contacts"&&!friendship.rowCount))return res.status(403).json({error:"Этот пользователь скрыл свой профиль"});
    const request=await pool.query("SELECT sender_id,status FROM friend_requests WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) ORDER BY created_at DESC LIMIT 1",[req.user.id,id]);
    const posts=await pool.query(`SELECT p.id,p.body,p.created_at,COUNT(l.user_id)::int AS likes,
      EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id=p.id AND l2.user_id=$2) AS liked,
      (SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id=p.id) AS comments_count
      FROM posts p LEFT JOIN likes l ON l.post_id=p.id WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 30`,[id,req.user.id]);
    const fr=request.rows[0];const status=friendship.rowCount?"friends":fr?.status==="pending"?(fr.sender_id===req.user.id?"sent":"received"):"none";
    res.json({...user.rows[0],is_me:false,friend_status:status,posts:posts.rows});
  }));
  app.post("/api/friends/request/:userId",auth,safe(async(req,res)=>{
    const id=Number(req.params.userId);if(!Number.isInteger(id)||id<1||id===req.user.id)return res.status(400).json({error:"Некорректный пользователь"});
    const target=await pool.query("SELECT id FROM users WHERE id=$1",[id]);if(!target.rowCount)return res.status(404).json({error:"Пользователь не найден"});
    const blocked=await pool.query("SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",[req.user.id,id]);if(blocked.rowCount)return res.status(403).json({error:"Нельзя отправить запрос этому пользователю"});
    const existing=await pool.query("SELECT sender_id,status FROM friend_requests WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) ORDER BY created_at DESC LIMIT 1",[req.user.id,id]);
    if(existing.rows[0]?.status==="pending")return res.status(409).json({error:"Запрос уже существует"});
    if(existing.rows[0]?.status==="accepted")return res.status(409).json({error:"Вы уже друзья"});
    await pool.query("INSERT INTO friend_requests(sender_id,recipient_id,status) VALUES($1,$2,'pending') ON CONFLICT(sender_id,recipient_id) DO UPDATE SET status='pending',created_at=NOW()",[req.user.id,id]);
    io.to("user:"+id).emit("friend:request",{from:req.user.id,username:req.user.username});res.status(201).json({ok:true,status:"sent"});
  }));
  app.post("/api/friends/requests/:requestId/accept",auth,safe(async(req,res)=>{
    const id=Number(req.params.requestId),c=await pool.connect();try{await c.query("BEGIN");const r=await c.query("SELECT * FROM friend_requests WHERE id=$1 AND recipient_id=$2 AND status='pending' FOR UPDATE",[id,req.user.id]);if(!r.rowCount){await c.query("ROLLBACK");return res.status(404).json({error:"Запрос не найден"});}const from=r.rows[0].sender_id,to=r.rows[0].recipient_id;await c.query("UPDATE friend_requests SET status='accepted' WHERE id=$1",[id]);await c.query("INSERT INTO user_friends(user_id,friend_id) VALUES($1,$2),($2,$1) ON CONFLICT DO NOTHING",[from,to]);await c.query("COMMIT");io.to("user:"+from).to("user:"+to).emit("friend:accepted",{userId:from===req.user.id?to:from});res.json({ok:true});}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }));
  app.delete("/api/friends/:userId",auth,safe(async(req,res)=>{
    const id=Number(req.params.userId);await pool.query("DELETE FROM user_friends WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)",[req.user.id,id]);await pool.query("UPDATE friend_requests SET status='declined' WHERE (sender_id=$1 AND recipient_id=$2 OR sender_id=$2 AND recipient_id=$1) AND status='accepted'",[req.user.id,id]);res.json({ok:true});
  }));
  app.get("/api/features/groups",auth,safe(async(req,res)=>{
    const r=await pool.query(`SELECT g.id,g.name,g.description,g.created_at,gm.role,
      (SELECT body FROM group_messages x WHERE x.group_id=g.id ORDER BY created_at DESC LIMIT 1) AS last_message
      FROM group_members gm JOIN groups_chat g ON g.id=gm.group_id WHERE gm.user_id=$1 ORDER BY g.created_at DESC`,[req.user.id]);res.json(r.rows);
  }));
  app.post("/api/features/groups",auth,safe(async(req,res)=>{
    const name=String(req.body.name||"").trim().slice(0,60),description=String(req.body.description||"").trim().slice(0,240),ids=Array.isArray(req.body.members)?req.body.members.map(Number).filter(x=>Number.isInteger(x)&&x>0&&x!==req.user.id).slice(0,49):[],usernames=Array.isArray(req.body.memberUsernames)?req.body.memberUsernames.map(x=>String(x).trim().toLowerCase()).filter(Boolean).slice(0,49):[];
    if(!name)return res.status(400).json({error:"Укажи название группы"});
    const c=await pool.connect();try{await c.query("BEGIN");const g=await c.query("INSERT INTO groups_chat(name,description,created_by) VALUES($1,$2,$3) RETURNING *",[name,description,req.user.id]);await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'admin')",[g.rows[0].id,req.user.id]);for(const id of ids)await c.query("INSERT INTO group_members(group_id,user_id) SELECT $1,id FROM users WHERE id=$2 ON CONFLICT DO NOTHING",[g.rows[0].id,id]);for(const username of usernames)await c.query("INSERT INTO group_members(group_id,user_id) SELECT $1,id FROM users WHERE username=$2 ON CONFLICT DO NOTHING",[g.rows[0].id,username]);await c.query("COMMIT");res.status(201).json({...g.rows[0],role:"admin"});}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }));
  app.get("/api/features/groups/:id/messages",auth,safe(async(req,res)=>{
    const id=Number(req.params.id),member=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:"Нет доступа к группе"});
    const r=await pool.query(`SELECT m.id,m.group_id,m.sender_id,m.body,m.attachment_name,m.attachment_mime,m.reply_to,m.edited_at,m.deleted_at,m.pinned,m.created_at,u.username
      FROM (SELECT * FROM group_messages WHERE group_id=$1 ORDER BY created_at DESC LIMIT 500) m JOIN users u ON u.id=m.sender_id ORDER BY m.created_at ASC`,[id]);res.json(r.rows);
  }));
  app.post("/api/features/groups/:id/messages",auth,safe(async(req,res)=>{
    const id=Number(req.params.id),body=String(req.body.body||"").trim();if(!body||body.length>4000)return res.status(400).json({error:"Сообщение должно содержать 1–4000 символов"});
    const member=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:"Нет доступа к группе"});
    const r=await pool.query("INSERT INTO group_messages(group_id,sender_id,body) VALUES($1,$2,$3) RETURNING *",[id,req.user.id,body]);const msg={...r.rows[0],username:req.user.username};io.to("group:"+id).emit("group:message",msg);res.status(201).json(msg);
  }));
  app.get("/api/features/groups/:id/members",auth,safe(async(req,res)=>{
    const id=Number(req.params.id);
    const own=await pool.query("SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2",[id,req.user.id]);
    if(!own.rowCount)return res.status(403).json({error:"Нет доступа к группе"});
    const r=await pool.query(`SELECT u.id,u.username,u.avatar_data,gm.role
      FROM group_members gm JOIN users u ON u.id=gm.user_id
      WHERE gm.group_id=$1 ORDER BY CASE WHEN gm.role='admin' THEN 0 ELSE 1 END,u.username`,[id]);
    res.json({members:r.rows,role:own.rows[0].role});
  }));
  app.post("/api/features/groups/:id/members",auth,safe(async(req,res)=>{
    const id=Number(req.params.id),admin=await pool.query("SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2",[id,req.user.id]);
    if(admin.rows[0]?.role!=="admin")return res.status(403).json({error:"Добавлять участников может администратор"});
    const raw=Array.isArray(req.body.userIds)?req.body.userIds:[req.body.userId];
    const ids=[...new Set(raw.map(Number).filter(x=>Number.isInteger(x)&&x>0&&x!==req.user.id))].slice(0,49);
    if(!ids.length)return res.status(400).json({error:"Выбери хотя бы одного пользователя"});
    const added=[];
    for(const target of ids){
      const r=await pool.query("INSERT INTO group_members(group_id,user_id) SELECT $1,id FROM users WHERE id=$2 ON CONFLICT DO NOTHING RETURNING user_id",[id,target]);
      if(r.rowCount){added.push(target);io.to("user:"+target).emit("group:added",{id});}
    }
    if(!added.length)return res.status(409).json({error:"Выбранные пользователи уже состоят в группе или не найдены"});
    io.to("group:"+id).emit("group:members-updated",{groupId:id});
    res.status(201).json({ok:true,added});
  }));
  app.delete("/api/features/groups/:id/members/:userId",auth,safe(async(req,res)=>{
    const id=Number(req.params.id),target=Number(req.params.userId),admin=await pool.query("SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2",[id,req.user.id]);if(req.user.id!==target&&admin.rows[0]?.role!=="admin")return res.status(403).json({error:"Недостаточно прав"});
    await pool.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2",[id,target]);res.json({ok:true});
  }));
  io.on("connection",socket=>{
    socket.on("group:join",async id=>{const group=Number(id);const r=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[group,socket.user.id]);if(r.rowCount)socket.join("group:"+group);});
    socket.on("typing",async data=>{const to=Number(data?.to);if(!to||to===socket.user.id)return;const r=await pool.query("SELECT typing_status FROM user_privacy WHERE user_id=$1",[socket.user.id]);if(r.rows[0]?.typing_status===false)return;io.to("user:"+to).emit("typing",{from:socket.user.id,active:!!data.active});});
    socket.on("presence:ping",()=>{socket.broadcast.emit("presence:update",{userId:socket.user.id,online:true});});
    socket.on("group:typing",async data=>{const id=Number(data?.groupId),r=await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",[id,socket.user.id]);if(r.rowCount)socket.to("group:"+id).emit("group:typing",{groupId:id,userId:socket.user.id,username:socket.user.username,active:!!data.active});});
  });
  return featureTables();
};
