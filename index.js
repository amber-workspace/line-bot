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
    console.log("👉 ADD ROW START");

    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key,
    });
console.log("👉 AUTH OK");

    await doc.loadInfo();

     console.log("👉 SHEET LOADED");

    

    const sheet = doc.sheetsByTitle[SHEET_NAME];

    if (!sheet) {
      console.log("Sheet not found:", SHEET_NAME);
      return;
    }

    await sheet.addRow({
      日期: new Date().toLocaleString(),
      項目: item,
      金額: amount,
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
  console.log("LINE EVENT RECEIVED:", JSON.stringify(event));

  if (event.type !== "message") return;

  if (!event.message || !event.message.text) return;

  const text = event.message.text;

  const parts = text.split(" ");

  if (parts.length !== 2) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "格式：項目 金額（例如 午餐 100）",
        },
      ],
    });
  }

  const [item, amount] = parts;

  try {
    await addRow(item, amount);

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: `已記錄：${item} ${amount}`,
        },
      ],
    });
  } catch (err) {
    console.error("addRow error:", err);

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "記錄失敗（Google Sheet 授權問題）",
        },
      ],
    });
  }
}

// Server start
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("🚀 Bot running on port", port);
});