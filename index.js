require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
//const { GoogleSpreadsheet } = require("google-spreadsheet");
const db = require("./db");
const axios = require("axios");

const app = express();

// LINE
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);


function addRow(lineUserId, item, amount) {
  try {

    const category = getCategory(item);

    const stmt = db.prepare(`
      INSERT INTO records
      (
        lineUserId,
        date,
        item,
        amount,
        category
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      lineUserId,
      new Date().toISOString().split("T")[0],
      item,
      amount,
      category
    );

    console.log("✔ 已寫入 SQLite");

  } catch (err) { 
    console.error("❌ addRow error:", err); 
  }
}

app.get("/", (req, res) => { res.send("LINE Bot is running"); });

// LINE webhook
app.post("/callback", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});


async function handleEvent(event) {

  // 只處理文字訊息
  if (event.type !== "message") return;

  if (!event.message || !event.message.text) return;

  if (!event.replyToken) return;
  if (!event.source || !event.source.userId) return;

  const lineUserId = event.source.userId;
  const text = event.message.text.trim();

  if (text === "刪除") {

    const deleted = deleteLastRecord(lineUserId);

    if (!deleted) {

      await client.replyMessage(
        event.replyToken,
        [
          {
            type: "text",
            text: "沒有資料可以刪除",
          },
        ]
      );

      return;
    }

    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: `已刪除：${deleted.item} ${deleted.amount}`,
        },
      ]
    );

    return;
  }

  if (text === "刪除今天") {

  const deletedCount = deleteTodayRecords(lineUserId);

  await client.replyMessage(
    event.replyToken,
    [
      {
        type: "text",
        text: `已刪除今天 ${deletedCount} 筆資料`,
      },
    ]
  );

  return;
}

  if (text === "今天") {

    //const rows = await getTodayRecords();
    const rows = getTodayRecords(lineUserId);

    if (rows.length === 0) {

      await client.replyMessage(
        event.replyToken,
        [
          {
            type: "text",
            text: "今天還沒有記帳資料",
          },
        ]
      );

      return;
    }

    let total = 0;

    const messages = rows.map(row => {

      total += Number(row.amount);

      return `${row.item} ${row.amount}（${row.category}）`;
    });

    const result =
  `📒 今天支出

  ${messages.join("\n")}

  💰 總計：${total} 元`;

    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: result,
        },
      ]
    );

    return;
  }

  if (text === "本月" || text === "當月") {

    const rows = getMonthRecords(lineUserId);

    if (rows.length === 0) {

      await client.replyMessage(
        event.replyToken,
        [
          {
            type: "text",
            text: "本月還沒有記帳資料",
          },
        ]
      );

      return;
    }

    // 分類統計
    const summary = {};

    let total = 0;

    rows.forEach(row => {

      const category = row.category || "其他";

      const amount = Number(row.amount);

      total += amount;

      if (!summary[category]) {
        summary[category] = 0;
      }

      summary[category] += amount;
    });

    // 組訊息
    let result = "📊 本月支出統計\n\n";

    for (const category in summary) {
      result += `${category}：${summary[category]} 元\n`;
    }

    result += `\n💰 本月總計：${total} 元`;

    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: result,
        },
      ]
    );

    return;
  }

  if (text === "排行") {

    const rows = getCategoryRanking(lineUserId);

    if (rows.length === 0) {
      await client.replyMessage(event.replyToken, [
        {
          type: "text",
          text: "本月還沒有資料"
        }
      ]);
      return;
    }

    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

    let result = "📊 本月支出排行\n\n";

    rows.forEach((row, index) => {

      const medal = medals[index] || `${index + 1}️⃣`;

      result += `${medal} ${row.category}：${row.total} 元\n`;
    });

    await client.replyMessage(event.replyToken, [
      {
        type: "text",
        text: result
      }
    ]);

    return;
  }

  if (text === "圖表") {

    const chartUrl = generatePieChart(lineUserId);

    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "image",
          originalContentUrl: chartUrl,
          previewImageUrl: chartUrl,
        },
      ]
    );

    return;
  }

  const lines = text.split("\n");

  let successMessages = [];

  for (const lineText of lines) {

    const parts = lineText.trim().split(" ");

    // 格式錯誤
    if (parts.length !== 2) {
      continue;
    }

    const [item, amountText] = parts; 
    const amount = Number(amountText); 
    if (isNaN(amount) || amount <= 0) { continue; }

    const category = getCategory(item);

    //await addRow(item, amount);
    addRow(lineUserId, item, amount);

    successMessages.push(
      `${item} ${amount}（${category}）`
    );
  }

  if (successMessages.length === 0) {

    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: "格式錯誤\n例如：午餐 100",
        },
      ]
    );

    return;
  }

  await client.replyMessage(
    event.replyToken,
    [
      {
        type: "text",
        text:
  `已記錄：

  ${successMessages.join("\n")}`,
      },
    ]
  );

}

// Server start
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("🚀 Bot running on port", port);
});

// 刪除最新一筆
function deleteLastRecord(lineUserId) {

  // 找最後一筆
  const stmt = db.prepare(`
    SELECT *
    FROM records
    WHERE lineUserId = ?
    ORDER BY id DESC
    LIMIT 1
  `);

  const row = stmt.get(lineUserId);

  if (!row) {
    return null;
  }

  // 刪除
  db.prepare(`
    DELETE FROM records
    WHERE id = ?
  `).run(row.id);

  return row;
}


// 刪除今天資料
function deleteTodayRecords(lineUserId) {

  const today = new Date().toISOString().split("T")[0];

  // 先查今天有幾筆
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM records
    WHERE lineUserId = ?
    AND date = ?
  `);

  const result = countStmt.get(lineUserId, today);

  // 刪除今天資料
  db.prepare(`
    DELETE FROM records
    WHERE lineUserId = ?
    AND date = ?
  `).run(lineUserId, today);

  return result.count;
}


// 今日統計 DB
function getTodayRecords(lineUserId) {

  const today = new Date().toISOString().split("T")[0];

  const stmt = db.prepare(`
    SELECT *
    FROM records
    WHERE lineUserId = ?
    AND date = ?
    ORDER BY id DESC
  `);

  return stmt.all(lineUserId, today);
}

// 本月統計
function getMonthRecords(lineUserId) {

  const currentMonth = new Date().toISOString().slice(0, 7);

  const stmt = db.prepare(`
    SELECT *
    FROM records
    WHERE lineUserId = ?
    AND substr(date, 1, 7) = ?
    ORDER BY id DESC
  `);

  return stmt.all(lineUserId, currentMonth);
}

// 排行
function getCategoryRanking(lineUserId) {

  const currentMonth = new Date().toISOString().slice(0, 7);

  const stmt = db.prepare(`
    SELECT 
      category,
      SUM(amount) as total
    FROM records
    WHERE lineUserId = ?
      AND substr(date, 1, 7) = ?
    GROUP BY category
    ORDER BY total DESC
  `);

  return stmt.all(lineUserId, currentMonth);
}


//圖表
function generatePieChart(lineUserId) {

  const rows = getMonthRecords(lineUserId);

  const summary = {};

  rows.forEach(row => {

    const category = row.category || "其他";

    const amount = Number(row.amount);

    if (!summary[category]) {
      summary[category] = 0;
    }

    summary[category] += amount;
  });

  const labels = Object.keys(summary);

  const data = Object.values(summary);

  const chartConfig = {
    type: "pie",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
        },
      ],
    },
  };

  const chartUrl =
    "https://quickchart.io/chart?c=" +
    encodeURIComponent(JSON.stringify(chartConfig));

  return chartUrl;
}


function getCategory(item) {

  if (item.includes("午餐") || item.includes("晚餐") || item.includes("早餐") || item.includes("點心")) {
    return "餐飲";
  }

  if (item.includes("咖啡") || item.includes("飲料")) {
    return "飲料";
  }

  if (item.includes("捷運") || item.includes("公車") || item.includes("計程車")) {
    return "交通";
  }

  return "其他";
}