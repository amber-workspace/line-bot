require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const axios = require("axios");

const app = express();

// LINE
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// Google Credentials
const creds = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

// Google Sheet
const SHEET_ID = "1GuaCuT9iu7K3fHO89MyaBHXfB7hTesYQBp_F-_L9img";
const SHEET_NAME = "工作表1";

// 寫入 Sheet
async function addRow(item, amount) {
  try {

    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key,
    });

    await doc.loadInfo();

    const sheet = doc.sheetsByTitle[SHEET_NAME];

    if (!sheet) {
      console.log("Sheet not found:", SHEET_NAME);
      return;
    }

    const category = getCategory(item);

    await sheet.addRow({
      日期: new Date().toISOString().split("T")[0],
      項目: item,
      金額: amount,
      類別: category,
    });

    console.log("✔ 已寫入 Google Sheet");
  } catch (err) {
    console.error("❌ addRow error:", err);
  }
}

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

  const text = event.message.text.trim();

  if (text === "刪除") {

    const deleted = await deleteLastRecord();

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

  const deletedCount = await deleteTodayRecords();

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

    const rows = await getTodayRecords();

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

      total += Number(row.金額);

      return `${row.項目} ${row.金額}（${row.類別}）`;
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

    const rows = await getMonthRecords();

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

      const category = row.類別 || "其他";

      const amount = Number(row.金額);

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

  if (text === "圖表") {

    const chartUrl = await generatePieChart();

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

    const [item, amount] = parts;

    const category = getCategory(item);

    await addRow(item, amount);

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

  //單筆新增
  /*const parts = text.split(" ");

  // 格式錯誤
  if (parts.length !== 2) {

    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: "格式：項目 金額（例如 午餐 100）",
        },
      ]
    );

    return;
  }

  const [item, amount] = parts;

  const category = getCategory(item);

  try {

    // 寫入 Google Sheet
    await addRow(item, amount);

    // 回覆成功訊息
    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: `已記錄：${item} ${amount}（${category}）`,
        },
      ]
    );

  } catch (err) {

    console.error("❌ handleEvent error:", err);

    // 回覆失敗訊息
    await client.replyMessage(
      event.replyToken,
      [
        {
          type: "text",
          text: "記錄失敗，請稍後再試",
        },
      ]
    );
  }*/
}

// Server start
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("🚀 Bot running on port", port);
});

//刪除最新1筆資料
async function deleteLastRecord() {

  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth({
    client_email: creds.client_email,
    private_key: creds.private_key,
  });

  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_NAME];

  const rows = await sheet.getRows();

  if (rows.length === 0) {
    return null;
  }

  // 最後一筆
  const lastRow = rows[rows.length - 1];

  const deletedData = {
    item: lastRow.項目,
    amount: lastRow.金額,
  };

  await lastRow.delete();

  return deletedData;
}

//刪除今日資料
async function deleteTodayRecords() {

  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth({
    client_email: creds.client_email,
    private_key: creds.private_key,
  });

  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_NAME];

  const rows = await sheet.getRows();

  // 今天日期
  const today = new Date().toISOString().split("T")[0];

  // 找今天資料
  const todayRows = rows.filter(row => {
    return row.日期 === today;
  });

  // ⭐ 倒著刪
  for (let i = todayRows.length - 1; i >= 0; i--) {
    await todayRows[i].delete();
  }

  return todayRows.length;
}

// 今日統計
async function getTodayRecords() {

  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth({
    client_email: creds.client_email,
    private_key: creds.private_key,
  });

  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_NAME];

  const rows = await sheet.getRows();

  const today = new Date().toISOString().split("T")[0];

  // 篩選今天資料
  const todayRows = rows.filter(row => {
    return row.日期.includes(today);
  });

  return todayRows;
}

//當月統計
async function getMonthRecords() {

  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth({
    client_email: creds.client_email,
    private_key: creds.private_key,
  });

  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_NAME];

  const rows = await sheet.getRows();

  // 取得本月 yyyy-mm
  const currentMonth = new Date().toISOString().slice(0, 7);

  // 篩選本月資料
  const monthRows = rows.filter(row => {
    return row.日期.startsWith(currentMonth);
  });

  return monthRows;
}

//圖表
async function generatePieChart() {

  const rows = await getMonthRecords();

  const summary = {};

  rows.forEach(row => {

    const category = row.類別 || "其他";

    const amount = Number(row.金額);

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

  if (item.includes("午餐") || item.includes("晚餐") || item.includes("早餐")) {
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