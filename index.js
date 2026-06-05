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

async function handleEvent(event) {

  try {
    // 只處理文字訊息
    if (event.type !== "message") return;

    if (!event.message || !event.message.text) return;

    if (!event.replyToken) return;
    if (!event.source || !event.source.userId) return;

    const lineUserId = event.source.userId;
    const text = event.message.text.trim();

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
        await client.replyMessage(
          event.replyToken,
          createErrorFlex("沒有資料可以刪除")
        );
        return;
      }

      await client.replyMessage(
        event.replyToken,
        createDeleteFlex(
          deleted.item,
          deleted.amount
        )
      );
      return;
    }

    if (text === "刪除今天") {

      const deletedCount = deleteTodayRecords(lineUserId);

      await client.replyMessage(
          event.replyToken,
          createDeleteTodayFlex(deletedCount)
        );
      return;
    }

    if (commands.TODAY.includes(text)) {

      //const rows = await getTodayRecords();
      const rows = getTodayRecords(lineUserId);

      if (rows.length === 0) {
        await client.replyMessage(
          event.replyToken,
          createErrorFlex("今天還沒有記帳資料")
        );
        return;
      }

      const total = rows.reduce(
        (sum, row) => sum + Number(row.amount),
        0
      );

      await client.replyMessage(
        event.replyToken,
        createTodayFlex(rows, total)
      );

      return;
    }

    if (commands.MONTH.includes(text)) {

      const rows = getMonthRecords(lineUserId);

      if (rows.length === 0) {
        await client.replyMessage(
          event.replyToken,
          createErrorFlex("本月還沒有記帳資料")
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

      const flexMessage = createMonthFlex(summary, total); 
      await client.replyMessage( event.replyToken, flexMessage );

      return;
    }

    if (commands.RANK.includes(text)) {

      const rows = getCategoryRanking(lineUserId);

      if (rows.length === 0) {
        await client.replyMessage(
          event.replyToken,
          createErrorFlex("本月還沒有資料")
        );
        return;
      }

      await client.replyMessage(
        event.replyToken,
        createRankFlex(rows)
      );
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
      await client.replyMessage(
        event.replyToken,
        createHelpFlex()
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

      // successMessages.push(
      //   `${item} ${amount}（${category}）`
      // );
      successMessages.push({
        item,
        amount,
        category
      });
    }

    if (successMessages.length === 0) {
      await client.replyMessage(
        event.replyToken,
        createInputErrorFlex()
      );
      return;
    }

    await client.replyMessage(
      event.replyToken,
      createRecordSuccessFlex(successMessages)
    );

  } catch (err) {

    console.error("❌ handleEvent error:", err);
    
    await client.replyMessage(
      event.replyToken,
      createErrorFlex("系統忙碌中，請稍後再試")
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


function createHeader(title, color = "#27ACB2") {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: color,
    paddingAll: "15px",
    contents: [
      {
        type: "text",
        text: title,
        color: "#FFFFFF",
        weight: "bold",
        size: "lg"
      }
    ]
  };
}

function createRecordSuccessFlex(records) {

  const rows = records.map(record => ({
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
        {
          type: "text",
          text: getCategoryEmoji(record.category),
          flex: 0
        },
        {
          type: "text",
          text: record.item,
          flex: 3
        },
        {
          type: "text",
          text: `$${record.amount}`,
          flex: 2,
          align: "end",
          weight: "bold"
        }
    ]
  }));

  return {
    type: "flex",
    altText: "記帳成功",
    contents: {
      type: "bubble",
      size: "mega",
      header: createHeader("📒 已記錄"),
      body: {
        type: "box",
        layout: "vertical",
        contents: rows
      }
    }
  };
}

function createTodayFlex(rows, total) {

  const contents = rows.map(row => ({
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "text",
        text: getCategoryEmoji(row.category),
        flex: 0
      },
      {
        type: "text",
        text: row.item,
        flex: 3,
        size: "sm"
      },
      {
        type: "text",
        text: `$${row.amount}`,
        align: "end",
        flex: 2,
        weight: "bold",
        size: "sm"
      }
    ]
  }));

  contents.push(
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
          weight: "bold"
        },
        {
          type: "text",
          text: `$${total}`,
          align: "end",
          weight: "bold",
          color: "#27ACB2"
        }
      ]
    }
  );

  return {
    type: "flex",
    altText: "今日支出",
    contents: {
      type: "bubble",
      size: "mega",
      header: createHeader("📅 今日支出"),
      body: {
        type: "box",
        layout: "vertical",
        contents
      }
    }
  };
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
      header: createHeader("📊 本月支出統計"),
      body: {
        type: "box",
        layout: "vertical",
        contents: [

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

function createRankFlex(rows) {

  const medals = [
    "🥇",
    "🥈",
    "🥉",
    "4️⃣",
    "5️⃣"
  ];

  const contents = rows.map((row, index) => ({
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      {
        type: "text",
        text: medals[index] || `${index + 1}`,
        flex: 1
      },
      {
        type: "text",
        text: row.category,
        flex: 3
      },
      {
        type: "text",
        text: `$${row.total}`,
        flex: 2,
        align: "end",
        weight: "bold"
      }
    ]
  }));

  return {
    type: "flex",
    altText: "支出排行",
    contents: {
      type: "bubble",
      size: "mega",
      header: createHeader("🏆 本月支出排行"),
      body: {
        type: "box",
        layout: "vertical",
        contents
      }
    }
  };
}


function createDeleteFlex(item, amount) {

  return {
    type: "flex",
    altText: "刪除成功",
    contents: {
      type: "bubble",
      header: createHeader("🗑️ 已刪除", "#E74C3C"),
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: item,
            weight: "bold",
            size: "lg"
          },
          {
            type: "text",
            text: `$${amount}`,
            margin: "md",
            color: "#E74C3C"
          }
        ]
      }
    }
  };
}

function createDeleteTodayFlex(count) {

  return {
    type: "flex",
    altText: `已刪除今天 ${count} 筆資料`,
    contents: {
      type: "bubble",
      size: "mega",
      header: createHeader(
        "🗑️ 已刪除今日資料",
        "#E74C3C"
      ),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "刪除完成",
            weight: "bold",
            size: "lg",
            align: "center"
          },
          {
            type: "text",
            text: `${count}`,
            size: "xxl",
            weight: "bold",
            color: "#E74C3C",
            align: "center"
          },
          {
            type: "text",
            text: "筆今日記錄已刪除",
            size: "sm",
            color: "#666666",
            align: "center"
          }
        ]
      }
    }
  };
}

function createHelpFlex() {

  return {
    type: "flex",
    altText: "使用說明",
    contents: {
      type: "bubble",
      size: "mega",
      header: createHeader("📘 使用說明"),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "✏️ 記帳",
            weight: "bold"
          },
          {
            type: "text",
            text: "午餐 100\n咖啡 80",
            size: "sm"
          },
          {
            type: "separator"
          },
          {
            type: "text",
            text: "📊 查詢",
            weight: "bold"
          },
          {
            type: "text",
            text: "今天\n本月\n排行\n圖表",
            size: "sm"
          },
          {
            type: "separator"
          },
          {
            type: "text",
            text: "🗑️ 操作",
            weight: "bold"
          },
          {
            type: "text",
            text: "撤銷\n刪除今天",
            size: "sm"
          }
        ]
      }
    }
  };
}

function createErrorFlex(message) {

  return {
    type: "flex",
    altText: "錯誤",
    contents: {
      type: "bubble",
      header: createHeader("⚠️ 提示", "#FF9800"),
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: message,
            wrap: true
          }
        ]
      }
    }
  };
}

function createInputErrorFlex() {
  return {
    type: "flex",
    altText: "輸入錯誤",
    contents: {
      type: "bubble",
      header: createHeader("❌ 無法辨識"),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "請輸入：",
            weight: "bold"
          },
          {
            type: "text",
            text: "午餐 100\n咖啡 80",
            size: "sm"
          },
          {
            type: "separator"
          },
          {
            type: "text",
            text: "可使用功能",
            weight: "bold"
          },
          {
            type: "text",
            text: "今天 / 本月 / 排行 / 圖表 / 撤銷",
            wrap: true,
            size: "sm"
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
