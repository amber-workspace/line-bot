require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
//const { GoogleSpreadsheet } = require("google-spreadsheet");
const db = require("./db");
const parseExpense = require("./parseExpense");

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
    return true;

  } catch (err) { 
    console.error("❌ addRow error:", err); 
    return false;
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


async function replyText(replyToken, text) {

  await client.replyMessage(
    replyToken,
    [
      {
        type: "text",
        text: text,
      },
    ]
  );
}

async function handleEvent(event) {

  try {
    // 只處理文字訊息
    if (event.type !== "message") return;

    if (!event.message || !event.message.text) return;

    if (!event.replyToken) return;
    if (!event.source || !event.source.userId) return;

    const lineUserId = event.source.userId;
    const text = event.message.text.trim();

    const undoCommands = ["刪除","撤銷","撤回","撤銷上一筆"];
    const commands = {
      TODAY: ["今天", "今日", "今日支出"],
      MONTH: ["本月", "當月", "本月統計"],
      RANK: ["排行", "分類排行"],
      CHART: ["圖表", "支出圖表"],
      HELP: ["說明", "help"],
      UNDO: ["刪除", "撤銷", "撤回", "撤銷上一筆"]
    };

    if (commands.UNDO.includes(text)) {

      const deleted = deleteLastRecord(lineUserId);

      if (!deleted) {

        await replyText(event.replyToken, "沒有資料可以刪除");
        return;
      }

      await replyText(event.replyToken, `已刪除：${deleted.item} ${deleted.amount}`);
      return;
    }

    if (text === "刪除今天") {

      const deletedCount = deleteTodayRecords(lineUserId);

      await replyText(event.replyToken, `已刪除今天 ${deletedCount} 筆資料`);
      return;
    }

    if (commands.TODAY.includes(text)) {

      //const rows = await getTodayRecords();
      const rows = getTodayRecords(lineUserId);

      if (rows.length === 0) {

        await replyText(event.replyToken, "今天還沒有記帳資料");
        return;
      }

      let total = 0;

      const messages = rows.map(row => {

        total += Number(row.amount);

        return `${row.item} ${row.amount}（${row.category}）`;
      });

      const result = [
        "📒 今日支出",
        "",
        ...messages,
        "",
        `💰 總計：${total} 元`
      ].join("\n");

      await replyText(event.replyToken, result);

      return;
    }

    if (commands.MONTH.includes(text)) {

      const rows = getMonthRecords(lineUserId);

      if (rows.length === 0) {

        await replyText(event.replyToken, "本月還沒有記帳資料");
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
      // let result = "📊 本月支出統計\n\n";

      // for (const category in summary) {
      //   result += `${category}：${summary[category]} 元\n`;
      // }

      // result += `\n💰 本月總計：${total} 元`;

      // await replyText(event.replyToken, result);

      const flexMessage = createMonthFlex(summary, total); 
      await client.replyMessage( event.replyToken, flexMessage );
      
      return;
    }

    if (commands.RANK.includes(text)) {

      const rows = getCategoryRanking(lineUserId);

      if (rows.length === 0) {
        await replyText(event.replyToken, "本月還沒有資料");
        return;
      }

      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

      let result = "📊 本月支出排行\n\n";

      rows.forEach((row, index) => {

        const medal = medals[index] || `${index + 1}️⃣`;

        result += `${medal} ${row.category}：${row.total} 元\n`;
      });

      await replyText(event.replyToken, result);
      return;
    }

    if (commands.CHART.includes(text)) {

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

    if (commands.HELP.includes(text)) {

      await replyText(
        event.replyToken,
        getHelpMessage()
      );

      return;
    }

    const lines = text.split("\n");

    let successMessages = [];

    for (const lineText of lines) {

      const parsed = parseExpense(lineText);

      if (!parsed) {
        continue;
      }

      const { item, amount } = parsed;
      
      if (!amount || amount <= 0) continue;

      const category = getCategory(item);
      
      const success = addRow(lineUserId, item, amount);

      if (!success) {
        continue;
      }

      successMessages.push(
        `${item} ${amount}（${category}）`
      );
    }

    if (successMessages.length === 0) {

      const helpMessage = [
        "❌ 無法辨識輸入內容",
        "",
        "請輸入：",
        "午餐 100",
        "",
        "或輸入以下功能：",
        "今天 / 本月 / 排行 / 圖表 / 撤銷"
      ].join("\n");

      await replyText(event.replyToken, helpMessage);
      return;
    }

    const result = [
        "📒 已記錄：",
        "",
        ...successMessages
      ].join("\n");

    await replyText(event.replyToken, result);

  } catch (err) {

    console.error("❌ handleEvent error:", err);

    await replyText(
      event.replyToken,
      "系統忙碌中，請稍後再試"
    );
  }

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
    ORDER BY id ASC
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
    ORDER BY id ASC
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

function getHelpMessage() {

  return [
    "📘 記帳小幫手使用說明",
    "",
    "✏️ 記帳",
    "午餐 100",
    "咖啡 80",
    "",
    "📊 查詢",
    "今天",
    "本月",
    "排行",
    "圖表",
    "",
    "🗑️ 操作",
    "撤銷",
    "刪除今天"
  ].join("\n");
}


function createMonthFlex(summary, total) {

  const contents = [];

  for (const category in summary) {

    contents.push({
      type: "box",
      layout: "horizontal",
      margin: "md",
      contents: [
        {
          type: "text",
          text: getCategoryEmoji(category),
          flex: 0,
          size: "sm"
        },
        {
          type: "text",
          text: category,
          size: "sm",
          color: "#555555",
          flex: 2
        },
        {
          type: "text",
          text: `$${summary[category]}`,
          size: "sm",
          color: "#111111",
          align: "end",
          flex: 2,
          weight: "bold"
        }
      ]
    });
  }

  return {
    type: "flex",
    altText: "本月支出統計",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        contents: [

          {
            type: "text",
            text: "📊 本月支出統計",
            weight: "bold",
            size: "xl"
          },

          {
            type: "separator",
            margin: "lg"
          },

          ...contents,

          {
            type: "separator",
            margin: "lg"
          },

          {
            type: "box",
            layout: "horizontal",
            margin: "lg",
            contents: [
              {
                type: "text",
                text: "總計",
                weight: "bold",
                size: "md"
              },
              {
                type: "text",
                text: `$${total}`,
                align: "end",
                weight: "bold",
                size: "lg",
                color: "#27ACB2"
              }
            ]
          }
        ]
      }
    }
  };
}


function getCategoryEmoji(category) {

  switch (category) {

    case "餐飲":
      return "🍱";

    case "飲料":
      return "🥤";

    case "交通":
      return "🚇";

    default:
      return "📦";
  }
}
