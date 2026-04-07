require('dotenv').config();

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_TOKEN");
  process.exit(1);
}

const LOCAL_WEBHOOK_URL = 'http://localhost:3000/api/telegram';
let lastUpdateId = 0;

async function poll() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    const data = await res.json();
    
    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        console.log(`Received message ID: ${update.message?.message_id}`);
        // Forward it exactly as a Webhook would to our Next.js backend
        await fetch(LOCAL_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update)
        });
      }
    }
  } catch(e) { /* ignore network timeouts */ }
  
  // keep polling
  setTimeout(poll, 1000);
}

// First, delete the old Webhook so Telegram allows getUpdates polling
fetch(`https://api.telegram.org/bot${token}/deleteWebhook`)
  .then(() => {
    console.log("✅ Local polling started! Bot is live and listening natively.");
    poll();
  });
