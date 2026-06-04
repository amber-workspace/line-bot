function parseExpense(text) {

  const clean = text.trim();

  // 1️⃣ 午餐 100
  let match = clean.match(/^(.+?)\s+(\d+)$/);
  if (match) {
    return {
      item: match[1],
      amount: Number(match[2])
    };
  }

  // 2️⃣ 100 午餐
  match = clean.match(/^(\d+)\s+(.+)$/);
  if (match) {
    return {
      item: match[2],
      amount: Number(match[1])
    };
  }

  // 3️⃣ 午餐100 / 咖啡120
  match = clean.match(/^(.+?)(\d+)$/);
  if (match) {
    return {
      item: match[1],
      amount: Number(match[2])
    };
  }

  // 4️⃣ 100午餐
  match = clean.match(/^(\d+)(.+)$/);
  if (match) {
    return { item: match[2], amount: Number(match[1]) };
  }

  return null;
}

module.exports = parseExpense;