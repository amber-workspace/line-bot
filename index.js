require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const creds = require("./google-credentials.json");

const app = express();

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

const SHEET_ID = "1GuaCuT9iu7K3fHO89MyaBHXfB7hTesYQBp_F-_L9img";
const SHEET_NAME = "工作表1";

app.post("/callback", line.middleware(config), async (req, res) => {
  const events = req.body.events;

  await Promise.all(events.map(handleEvent));

  res.sendStatus(200);
});

async function handleEvent(event) {
  if (event.type !== "message") {
    return null;
  }

  const userText = event.message.text;

  const parts = userText.split(" ");

  // 格式：午餐 120
  if (parts.length !== 2) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "格式錯誤，請輸入：項目 金額（例如 午餐 120）",
        },
      ],
    });
    return;
  }

  const item = parts[0];
  const amount = parts[1];

  // ⭐寫入 Google Sheet
  await addRow(item, amount);

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: "text",
        text: `已記錄：${item} ${amount}`,
      },
    ],
  });
}

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

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});