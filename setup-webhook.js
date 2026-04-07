require('dotenv').config();

const VERCEL_URL = 'https://alfred-navy-xi.vercel.app';

(async () => {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_TOKEN in .env");

  const webhookUrl = `${VERCEL_URL}/api/telegram`;
  console.log('Setting webhook to:', webhookUrl);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl })
  });

  const result = await res.json();
  console.log('Telegram API Response:', result);

  if (result.ok) {
    console.log('✅ BOT IS LIVE at', webhookUrl);
  } else {
    console.error('❌ Webhook failed:', result.description);
  }
})();
