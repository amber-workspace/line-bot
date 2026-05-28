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

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

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
  if (event.type !== "message") return;

  const text = event.message.text.trim();

  const parts = text.split(" ");

  if (parts.length !== 2) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "格式：項目 金額（例如 午餐 120）",
        },
      ],
    });
  }

  const item = parts[0];
  const amount = parts[1];

  // 寫入 Sheet
  await addRow(item, amount);

  // 回覆 LINE
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: "text",
        text: `已記錄：${item} ${amount}`,
      },
    ],
  });
}

// Server start
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("🚀 Bot running on port", port);
});