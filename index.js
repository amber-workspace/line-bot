require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");

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
`📒 今日支出

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

  const parts = text.split(" ");

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
  }
}

// Server start
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("🚀 Bot running on port", port);
});

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