require('dotenv').config();

const VERCEL_URL = 'https://alfred-navy-xi.vercel.app';

(async () => {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_TOKEN in .env");

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing TELEGRAM_WEBHOOK_SECRET in .env");

  const webhookUrl = `${VERCEL_URL}/api/telegram`;
  console.log('Setting webhook to:', webhookUrl);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,  // Telegram will send this as X-Telegram-Bot-Api-Secret-Token on every request
    })
  });

  const result = await res.json();
  console.log('Telegram API Response:', result);

  if (result.ok) {
    console.log('✅ Webhook registered with secret token. Only Telegram can now trigger Alfred.');
  } else {
    console.error('❌ Webhook failed:', result.description);
  }
})();
