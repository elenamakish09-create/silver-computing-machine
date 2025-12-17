import bcrypt from "bcryptjs";
import cors from 'cors';
import express from 'express';
import OpenAI from "openai";
import pkg from "pg";

const app = express();
app.use(cors());
app.use(express.json());
const {Pool} = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query("SELECT 1")
  .then(() => console.log("PostgreSQL connected"))
  .catch(err => console.error("PG error", err));


  app.get("/init-db", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        pin_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.send("DB initialized");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get("/", (req, res) => {
  res.send("Server alive");
});

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
app.post("/check-tasks", async (req, res) => {
  try {
    const { answers } = req.body;
    const correctAnswers = {
      1: "нельзя", 
      2: 1,
      3: 'q3 = -2e',
      4: 2,
      5: 0          
    };
    const prompt = `
Ты проверяешь задачи по электродинамике.

Вот правильные ответы на задачи:
${JSON.stringify(correctAnswers, null, 2)}

Ответы ученика:
${JSON.stringify(answers, null, 2)}

Что нужно сделать:
1. Проанализировать каждый ответ — текстовый или выбранный вариант.
2. Подсчитать количество верных ответов.
3. Поставить оценку от 0.0 до 5.0.
4. Сформировать короткий, но профессиональный совет, что улучшить.
5. Вернуть результат строго в формате JSON:

{
  "score": "число от 0 до 5",
  "correctCount": "сколько задач выполнено верно",
  "advice": "короткий совет"
}

Не добавляй объяснений вне JSON.
`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    });

    const raw = response.choices[0].message.content;

    let result;
    try {
      result = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({
        error: "AI JSON parse error",
        raw
      });
    }

    res.json(result);

  } catch (error) {
    console.log("TASKS ERROR:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/check-test", async (req, res) => {
  console.log(">>> Запрос ПОЛУЧЕН");

  try {
    const { answers } = req.body;

    const correctAnswers = {
      1:2, 2:1, 3:1, 4:1, 5:2,
      6:1, 7:2, 8:3, 9:2, 10:0,
    };

    const prompt = `
Проверь ответы пользователя.
Правильные ответы: ${JSON.stringify(correctAnswers)}
Ответы пользователя: ${JSON.stringify(answers)}

Верни только JSON строго в формате:
{
  "score": "оценка",
  "advice": "совет"
}
Без текста вне JSON.
    `;

    const ai = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    });

    const raw = ai.choices[0].message.content;
    console.log(">>> RAW:", raw);

    const extractJson = (text) => {
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}") + 1;
        return JSON.parse(text.slice(start, end));
      } catch {
        return {
          score: "0",
          advice: "Ошибка обработки ответа ИИ"
        };
      }
    };

    const parsed = extractJson(raw);

    res.json(parsed);
  } catch (err) {
    console.error(">>> SERVER ERROR:", err);
    res.status(500).json({
      error: "AI failure",
      details: err.message
    });
  }
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});


app.post("/auth", async (req, res) => {
  try {

    const { username, pin } = req.body;

    if (!username || !pin)
      return res.json({ success:false, error:"Введите ник и PIN" });

    if (!/^\d{4}$/.test(pin))
      return res.json({ success:false, error:"PIN должен состоять из 4 цифр" });

    db.query(
      "SELECT * FROM student WHERE username = ?",
      [username],
      async (err, rows) => {

        if (err)
          return res.status(500).json({ error:"DB error" });

        if (!rows.length) {

          const hash = await bcrypt.hash(pin, 10);

          db.query(
            "INSERT INTO student (username, pin_hash) VALUES (?,?)",
            [username, hash]
          );

          return res.json({
            success:true,
            action:"register"
          });
        }

        const user = rows[0];

        if (!user.pin_hash)
          return res.json({
            success:false,
            error:"PIN не задан"
          });

        const ok = await bcrypt.compare(pin, user.pin_hash);

        if (!ok)
          return res.json({
            success:false,
            error:"Неверный PIN"
          });

        return res.json({
          success:true,
          action:"login"
        });
      }
    );

  } catch (e) {
    console.log("AUTH FATAL:", e);

    return res.status(500).json({
      error:"Auth failed"
    });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});