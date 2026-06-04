const Database = require("better-sqlite3");

const db = new Database("account.db");

// 建立資料表
db.exec(`
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lineUserId TEXT,
  date TEXT,
  item TEXT,
  amount INTEGER,
  category TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

console.log("✔ SQLite connected");

module.exports = db;