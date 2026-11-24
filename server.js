const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");

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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
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
app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

app.get("/api/users", auth, async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const result = await pool.query(
    "SELECT id,username FROM users WHERE id<>$1 AND username LIKE $2 ORDER BY username LIMIT 40",
    [req.user.id, `%${q.slice(0,24)}%`]
  );
  res.json(result.rows);
});

app.get("/api/posts", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT p.id,p.body,p.created_at,u.id AS user_id,u.username,
      COUNT(l.user_id)::int AS likes,
      BOOL_OR(l.user_id=$1) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id
    LEFT JOIN likes l ON l.post_id=p.id
    GROUP BY p.id,u.id ORDER BY p.created_at DESC LIMIT 100
  `, [req.user.id]);
  res.json(result.rows);
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

app.get("/api/messages/:userId", auth, async (req, res) => {
  const other = Number(req.params.userId);
  const result = await pool.query(`
    SELECT m.id,m.sender_id,m.recipient_id,m.body,m.message_type,encode(m.audio_data,'base64') AS audio_base64,m.audio_mime,m.created_at,u.username AS sender_name
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE (m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1)
    ORDER BY m.created_at ASC LIMIT 300
  `, [req.user.id, other]);
  res.json(result.rows);
});

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    next();
  } catch { next(new Error("Не авторизован")); }
});
io.on("connection", socket => {
  socket.join(`user:${socket.user.id}`);
  socket.on("message:send", async (payload, callback) => {
    try {
      const recipient = Number(payload?.recipientId);
      const isAudio = Boolean(payload?.audio_base64);
      const body = isAudio ? "Голосовое сообщение" : String(payload?.body || "").trim();
      const audio = isAudio ? Buffer.from(String(payload.audio_base64), "base64") : null;
      const audioMime = isAudio ? String(payload.audio_mime || "audio/webm").slice(0,100) : null;
      if (!recipient || recipient === socket.user.id || (!isAudio && (!body || body.length > 4000)) ||
          (isAudio && (!audio.length || audio.length > 5*1024*1024 || !/^audio\//.test(audioMime)))) throw new Error("Некорректное сообщение");
      const target = await pool.query("SELECT id FROM users WHERE id=$1", [recipient]);
      if (!target.rowCount) throw new Error("Пользователь не найден");
      const result = await pool.query(
        "INSERT INTO messages(sender_id,recipient_id,body,message_type,audio_data,audio_mime) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,sender_id,recipient_id,body,message_type,encode(audio_data,'base64') AS audio_base64,audio_mime,created_at",
        [socket.user.id, recipient, body, isAudio ? "audio" : "text", audio, audioMime]
      );
      const message = { ...result.rows[0], sender_name: socket.user.username };
      io.to(`user:${recipient}`).to(`user:${socket.user.id}`).emit("message:new", message);
      if (callback) callback({ ok: true, message });
    } catch (e) { if (callback) callback({ ok: false, error: e.message }); }
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
initDb().then(() => server.listen(PORT, () => console.log(`KIKO listening on ${PORT}`)))
  .catch(err => { console.error("Database initialization failed", err); process.exit(1); });
