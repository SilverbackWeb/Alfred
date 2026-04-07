const localtunnel = require('localtunnel');
require('dotenv').config();

(async () => {
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log('Public URL:', tunnel.url);

    const token = process.env.TELEGRAM_TOKEN;
    if (!token) throw new Error("Missing TELEGRAM_TOKEN in .env");

    const webhookUrl = `${tunnel.url}/api/telegram`;
    console.log('Applying Webhook:', webhookUrl);

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    });
    
    const result = await res.json();
    console.log('Telegram API Response:', result);
    
    if (result.ok) {
        console.log('✅ BOT IS LIVE! You can now chat with your Personal PA on Telegram.');
    } else {
        console.error('❌ Webhook failed. Verify your token.');
    }

    tunnel.on('close', () => console.log('Tunnel closed'));
    
    // Prevent Node from exiting
    setInterval(() => {}, 1000 * 60 * 60);
  } catch(e) {
    console.error("Error in tunnel script:", e.message);
  }
})();
