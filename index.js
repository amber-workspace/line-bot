require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const app = express();

// LINE
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

const creds = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

// Google Sheet
const SHEET_ID = "1GuaCuT9iu7K3fHO89MyaBHXfB7hTesYQBp_F-_L9img";
const SHEET_NAME = "工作表1";

// 寫入 Sheet
async function addRow(item, amount) {
  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_NAME];

  await sheet.addRow({
    日期: new Date().toLocaleString(),
    項目: item,
    金額: amount,
  });
}

// LINE webhook
app.post("/callback", line.middleware(config), async (req, res) => {
  const events = req.body.events;

  await Promise.all(events.map(handleEvent));

  res.sendStatus(200);
});

async function handleEvent(event) {
  if (event.type !== "message") return;

  const text = event.message.text;

  // 簡單解析：午餐 120
  const parts = text.split(" ");

  if (parts.length !== 2) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "格式：項目 金額（例如 午餐 120）" }],
    });
  }

  const item = parts[0];
  const amount = parts[1];

  await addRow(item, amount);

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: "text", text: `已記錄：${item} ${amount}` }],
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("Bot running");
});