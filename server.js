const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");
const installKikoFeatures = require("./features");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false } : undefined
});

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.json({ ok: true }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(24) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      avatar_data TEXT,
      status VARCHAR(80) NOT NULL DEFAULT '',
      theme VARCHAR(20) NOT NULL DEFAULT 'light',
      accent VARCHAR(20) NOT NULL DEFAULT 'pink',
      wallpaper VARCHAR(20) NOT NULL DEFAULT 'soft'
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(80) NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(20) NOT NULL DEFAULT 'light';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS accent VARCHAR(20) NOT NULL DEFAULT 'pink';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS wallpaper VARCHAR(20) NOT NULL DEFAULT 'soft';
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body VARCHAR(1000) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS likes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS post_comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body VARCHAR(1000) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments(post_id, created_at);
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body VARCHAR(4000) NOT NULL,
      message_type VARCHAR(10) NOT NULL DEFAULT 'text',
      audio_data BYTEA,
      audio_mime VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(10) NOT NULL DEFAULT 'text';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_data BYTEA;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_mime VARCHAR(100);
    CREATE TABLE IF NOT EXISTS call_history (
      call_id VARCHAR(80) PRIMARY KEY,
      caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      call_type VARCHAR(10) NOT NULL CHECK (call_type IN ('audio','video')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'ongoing'
    );
    CREATE INDEX IF NOT EXISTS call_history_pair_idx ON call_history(caller_id, recipient_id, started_at);
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(message_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender_id, recipient_id, created_at);
    CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at DESC);
  `);
}

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    if (!token) throw new Error("missing token");
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Войдите в аккаунт" });
  }
}
function safeUser(row) { return { id: row.id, username: row.username }; }

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[a-zа-яё0-9_]{3,24}$/i.test(username))
      return res.status(400).json({ error: "Имя: 3–24 символа, буквы, цифры или _" });
    if (password.length < 8) return res.status(400).json({ error: "Пароль должен быть не короче 8 символов" });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query("INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id,username", [username, hash]);
    const user = safeUser(result.rows[0]);
    res.json({ token: sign(user), user });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Это имя уже занято" });
    console.error(e); res.status(500).json({ error: "Не удалось создать аккаунт" });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const result = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(String(req.body.password || ""), row.password_hash)))
      return res.status(401).json({ error: "Неверное имя или пароль" });
    const user = safeUser(row);
    res.json({ token: sign(user), user });
  } catch (e) { console.error(e); res.status(500).json({ error: "Ошибка входа" }); }
});
app.get("/api/me", auth, async (req, res) => { const r=await pool.query("SELECT id,username,avatar_data,status,theme,accent,wallpaper FROM users WHERE id=$1",[req.user.id]); res.json({user:r.rows[0]}); });
app.get("/api/profile",auth,async(req,res)=>{const r=await pool.query("SELECT id,username,avatar_data,status,theme,accent,wallpaper FROM users WHERE id=$1",[req.user.id]);res.json(r.rows[0]);});
app.put("/api/profile",auth,async(req,res)=>{try{const b=req.body||{};const status=b.status===undefined?null:String(b.status).slice(0,80);const avatar=b.avatar_data===undefined?undefined:(b.avatar_data===null?null:String(b.avatar_data));if(avatar!==undefined&&avatar!==null&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)||avatar.length>2100000))return res.status(400).json({error:"Некорректная аватарка"});const theme=["light","dark","lavender","midnight"].includes(b.theme)?b.theme:undefined;const accent=["pink","violet","blue","mint","orange"].includes(b.accent)?b.accent:undefined;const wallpaper=["soft","gradient","grid","plain"].includes(b.wallpaper)?b.wallpaper:undefined;const r=await pool.query("UPDATE users SET status=COALESCE($2,status),avatar_data=COALESCE($3,avatar_data),theme=COALESCE($4,theme),accent=COALESCE($5,accent),wallpaper=COALESCE($6,wallpaper) WHERE id=$1 RETURNING id,username,avatar_data,status,theme,accent,wallpaper",[req.user.id,status,avatar===undefined?null:avatar,theme||null,accent||null,wallpaper||null]);res.json(r.rows[0]);}catch(e){console.error(e);res.status(500).json({error:"Не удалось сохранить профиль"});}});


app.get("/api/chats", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT u.id,u.username,u.status,u.avatar_data,latest.body AS last_message,latest.created_at AS last_message_at
    FROM (
      SELECT CASE WHEN sender_id=$1 THEN recipient_id ELSE sender_id END AS user_id,
             MAX(created_at) AS last_at
      FROM messages WHERE sender_id=$1 OR recipient_id=$1
      GROUP BY CASE WHEN sender_id=$1 THEN recipient_id ELSE sender_id END
    ) recent
    JOIN users u ON u.id=recent.user_id
    JOIN LATERAL (
      SELECT body,created_at FROM messages m
      WHERE (m.sender_id=$1 AND m.recipient_id=u.id) OR (m.sender_id=u.id AND m.recipient_id=$1)
      ORDER BY created_at DESC LIMIT 1
    ) latest ON true
    ORDER BY recent.last_at DESC
    LIMIT 100
  `, [req.user.id]);
  res.json(result.rows);
});

app.get("/api/users", auth, async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase().slice(0,24);
  // Never expose a directory of registered users: search is opt-in and requires at least 2 characters.
  if (q.length < 2) return res.json([]);
  const result = await pool.query(
    "SELECT id,username,status,avatar_data FROM users WHERE id<>$1 AND username ILIKE $2 ORDER BY username LIMIT 40",
    [req.user.id, `%${q}%`]
  );
  res.json(result.rows);
});

app.get("/api/posts", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT p.id,p.body,p.created_at,u.id AS user_id,u.username,
      COUNT(l.user_id)::int AS likes,
      BOOL_OR(l.user_id=$1) AS liked,
      (SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id=p.id) AS comments_count
    FROM posts p JOIN users u ON u.id=p.user_id
    LEFT JOIN likes l ON l.post_id=p.id
    GROUP BY p.id,u.id ORDER BY p.created_at DESC LIMIT 100
  `, [req.user.id]);
  res.json(result.rows);
});
app.get("/api/posts/:id/comments", auth, async (req, res) => {
  const postId=Number(req.params.id);
  if(!Number.isInteger(postId)||postId<1)return res.status(400).json({error:"Некорректная публикация"});
  const result=await pool.query(
    `SELECT pc.id,pc.post_id,pc.user_id,pc.body,pc.created_at,u.username
     FROM post_comments pc JOIN users u ON u.id=pc.user_id
     WHERE pc.post_id=$1 ORDER BY pc.created_at ASC LIMIT 500`,[postId]
  );
  res.json(result.rows);
});
app.post("/api/posts/:id/comments", auth, async (req, res) => {
  try{
    const postId=Number(req.params.id),body=String(req.body.body||"").trim();
    if(!Number.isInteger(postId)||postId<1||!body||body.length>1000)
      return res.status(400).json({error:"Комментарий должен содержать от 1 до 1000 символов"});
    const exists=await pool.query("SELECT id FROM posts WHERE id=$1",[postId]);
    if(!exists.rowCount)return res.status(404).json({error:"Публикация не найдена"});
    const result=await pool.query(
      `INSERT INTO post_comments(post_id,user_id,body) VALUES($1,$2,$3)
       RETURNING id,post_id,user_id,body,created_at`,[postId,req.user.id,body]
    );
    const comment={...result.rows[0],username:req.user.username};
    io.emit("post:comment",comment);
    res.status(201).json(comment);
  }catch(e){console.error(e);res.status(500).json({error:"Не удалось добавить комментарий"});}
});
app.post("/api/posts", auth, async (req, res) => {
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 1000) return res.status(400).json({ error: "Пост должен содержать от 1 до 1000 символов" });
  const result = await pool.query("INSERT INTO posts(user_id,body) VALUES($1,$2) RETURNING id,body,created_at", [req.user.id, body]);
  const post = { ...result.rows[0], user_id: req.user.id, username: req.user.username, likes: 0, liked: false };
  io.emit("post:new", post);
  res.status(201).json(post);
});
app.post("/api/posts/:id/like", auth, async (req, res) => {
  const id = Number(req.params.id);
  const exists = await pool.query("SELECT 1 FROM posts WHERE id=$1", [id]);
  if (!exists.rowCount) return res.status(404).json({ error: "Публикация не найдена" });
  const liked = await pool.query("SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2", [req.user.id, id]);
  if (liked.rowCount) await pool.query("DELETE FROM likes WHERE user_id=$1 AND post_id=$2", [req.user.id, id]);
  else await pool.query("INSERT INTO likes(user_id,post_id) VALUES($1,$2)", [req.user.id, id]);
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM likes WHERE post_id=$1", [id]);
  const data = { postId: id, likes: count.rows[0].count, userId: req.user.id, liked: !liked.rowCount };
  io.emit("post:like", data);
  res.json(data);
});

app.get("/api/calls/:userId", auth, async (req, res) => {
  const other = Number(req.params.userId);
  if (!Number.isInteger(other) || other < 1) return res.status(400).json({ error: "Некорректный собеседник" });
  const result = await pool.query(
    `SELECT call_id,caller_id,recipient_id,call_type,started_at,ended_at,duration_seconds,status
     FROM call_history WHERE (caller_id=$1 AND recipient_id=$2) OR (caller_id=$2 AND recipient_id=$1)
     ORDER BY started_at ASC LIMIT 200`,
    [req.user.id, other]
  );
  res.json(result.rows);
});

app.get("/api/messages/:userId", auth, async (req, res) => {
  const other = Number(req.params.userId);
  const result = await pool.query(`
    SELECT * FROM (
      SELECT m.id,m.sender_id,m.recipient_id,m.body,m.message_type,encode(m.audio_data,'base64') AS audio_base64,m.audio_mime,m.reply_to,m.edited_at,m.deleted_at,m.pinned,m.attachment_name,m.attachment_mime,(SELECT p.body FROM messages p WHERE p.id=m.reply_to) AS reply_body,m.created_at,u.username AS sender_name
      FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE (m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1)
      ORDER BY m.created_at DESC,m.id DESC LIMIT 500
    ) recent_messages
    ORDER BY created_at ASC,id ASC
  `, [req.user.id, other]);
  res.json(result.rows);
});


app.post("/api/messages/:messageId/reaction", auth, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    const emoji = String(req.body.emoji || "");
    const allowed = ["❤️","👍","😂","😮","😢","🔥","👏","😍"];
    if (!Number.isInteger(messageId) || messageId < 1 || !allowed.includes(emoji))
      return res.status(400).json({ error: "Некорректная реакция" });
    const found = await pool.query(
      "SELECT id,sender_id,recipient_id FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)",
      [messageId, req.user.id]
    );
    if (!found.rowCount) return res.status(404).json({ error: "Сообщение не найдено" });
    const current = await pool.query("SELECT emoji FROM message_reactions WHERE message_id=$1 AND user_id=$2", [messageId, req.user.id]);
    if (current.rows[0]?.emoji === emoji) {
      await pool.query("DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2", [messageId, req.user.id]);
    } else {
      await pool.query(
        "INSERT INTO message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=EXCLUDED.emoji,created_at=NOW()",
        [messageId, req.user.id, emoji]
      );
    }
    const aggregate = await pool.query(
      "SELECT emoji,COUNT(*)::int AS count,BOOL_OR(user_id=$2) AS mine FROM message_reactions WHERE message_id=$1 GROUP BY emoji ORDER BY MIN(created_at)",
      [messageId, req.user.id]
    );
    const data = { messageId, reactions: aggregate.rows };
    const message = found.rows[0];
    io.to(`user:${message.sender_id}`).to(`user:${message.recipient_id}`).emit("message:reaction", data);
    res.json(data);
  } catch (e) { console.error(e); res.status(500).json({ error: "Не удалось сохранить реакцию" }); }
});

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    next();
  } catch { next(new Error("Не авторизован")); }
});
io.on("connection", socket => {
  socket.join(`user:${socket.user.id}`);

  socket.on("call:signal", async payload => {
    try {
      const to = Number(payload?.to);
      const type = String(payload?.type || "");
      if (!Number.isInteger(to) || to < 1 || to === socket.user.id ||
          !["offer","answer","ice","end","reject","busy"].includes(type)) return;
      const target = await pool.query("SELECT id FROM users WHERE id=$1", [to]);
      if (!target.rowCount) return;
      io.to(`user:${to}`).emit("call:signal", {
        type, from: socket.user.id, fromName: socket.user.username,
        data: payload.data || null, callType: payload.callType === "video" ? "video" : "audio",
        callId: String(payload.callId || "")
      });
    } catch (e) { console.error("Call signaling failed", e); }
  });
  socket.on("call:history:start", async payload => {
    try {
      const to = Number(payload?.to), callId = String(payload?.callId || "").slice(0,80);
      const callType = payload?.callType === "video" ? "video" : "audio";
      if (!Number.isInteger(to) || to < 1 || to === socket.user.id || !callId) return;
      const target = await pool.query("SELECT id FROM users WHERE id=$1", [to]);
      if (!target.rowCount) return;
      const result = await pool.query(
        `INSERT INTO call_history(call_id,caller_id,recipient_id,call_type,started_at,status)
         VALUES($1,$2,$3,$4,NOW(),'ongoing') ON CONFLICT(call_id) DO NOTHING
         RETURNING call_id,caller_id,recipient_id,call_type,started_at,ended_at,duration_seconds,status`,
        [callId,socket.user.id,to,callType]
      );
      if (result.rowCount) {
        const row=result.rows[0];
        io.to(`user:${row.caller_id}`).to(`user:${row.recipient_id}`).emit("call:history:update",row);
      }
    } catch(e) { console.error("Call history start failed",e); }
  });
  socket.on("call:history:end", async payload => {
    try {
      const callId=String(payload?.callId || "").slice(0,80);
      if(!callId)return;
      const result=await pool.query(
        `UPDATE call_history SET ended_at=NOW(),
         duration_seconds=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-started_at)))::int),
         status='completed'
         WHERE call_id=$1 AND (caller_id=$2 OR recipient_id=$2) AND ended_at IS NULL
         RETURNING call_id,caller_id,recipient_id,call_type,started_at,ended_at,duration_seconds,status`,
        [callId,socket.user.id]
      );
      if(result.rowCount){
        const row=result.rows[0];
        io.to(`user:${row.caller_id}`).to(`user:${row.recipient_id}`).emit("call:history:update",row);
      }
    } catch(e) { console.error("Call history end failed",e); }
  });
  socket.on("message:send", async (payload, callback) => {
    try {
      const recipient = Number(payload?.recipientId);
      const isAudio = Boolean(payload?.audio_base64);
      const replyTo = Number(payload?.reply_to) || null;
      const body = isAudio ? "Голосовое сообщение" : String(payload?.body || "").trim();
      const audio = isAudio ? Buffer.from(String(payload.audio_base64), "base64") : null;
      const audioMime = isAudio ? String(payload.audio_mime || "audio/webm").slice(0,100) : null;
      if (!recipient || recipient === socket.user.id || (!isAudio && (!body || body.length > 4000)) ||
          (isAudio && (!audio.length || audio.length > 5*1024*1024 || !/^audio\//.test(audioMime)))) throw new Error("Некорректное сообщение");
      const target = await pool.query("SELECT id FROM users WHERE id=$1", [recipient]);
      if (!target.rowCount) throw new Error("Пользователь не найден");
      if (replyTo) { const parent = await pool.query("SELECT id FROM messages WHERE id=$1 AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2)) AND deleted_at IS NULL", [replyTo,socket.user.id,recipient]); if (!parent.rowCount) throw new Error("Сообщение для ответа не найдено"); }
      const result = await pool.query(
        "INSERT INTO messages(sender_id,recipient_id,body,message_type,audio_data,audio_mime,reply_to) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,sender_id,recipient_id,body,message_type,encode(audio_data,'base64') AS audio_base64,audio_mime,reply_to,created_at",
        [socket.user.id, recipient, body, isAudio ? "audio" : "text", audio, audioMime, replyTo]
      );
      const message = { ...result.rows[0], sender_name: socket.user.username };
      io.to(`user:${recipient}`).to(`user:${socket.user.id}`).emit("message:new", message);
      if (callback) callback({ ok: true, message });
    } catch (e) { if (callback) callback({ ok: false, error: e.message }); }
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
initDb().then(async () => {
    await installKikoFeatures({ app, io, pool, auth });
    server.listen(PORT, () => console.log(`KIKO listening on ${PORT}`));
  })
  .catch(err => { console.error("Database initialization failed", err); process.exit(1); });
