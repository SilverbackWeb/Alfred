import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getContactById } from "@/lib/gohighlevel";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

async function sendTelegram(chatId: string, text: string) {
  if (!TELEGRAM_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Only handle inbound messages
    const type = body.type || body.event;
    if (!type?.toLowerCase().includes("inbound")) {
      return NextResponse.json({ ok: true });
    }

    const messageType: string = body.messageType || body.type || "Message";
    const contactId: string | undefined = body.contactId;
    const rawBody: string = body.body || body.message?.body || "";
    const subject: string = body.subject || "";

    if (!rawBody && !subject) {
      return NextResponse.json({ ok: true });
    }

    // Look up contact name from GHL
    let senderName = body.contactName || body.name || "Unknown";
    if (contactId && senderName === "Unknown") {
      const contact = await getContactById(contactId);
      if (contact?.name) senderName = contact.name;
    }

    // Build notification text
    const isEmail = messageType.toLowerCase().includes("email");
    const isSMS = messageType.toLowerCase().includes("sms");
    const typeLabel = isEmail ? "📧 Email" : isSMS ? "📱 Text" : "💬 Message";

    let notifText = `${typeLabel} from ${senderName}`;
    if (isEmail && subject) notifText += `\nSubject: ${subject}`;
    if (rawBody) notifText += `\n\n${rawBody.slice(0, 500)}`;
    if (rawBody.length > 500) notifText += "\n[...]";

    // Find the owner's Telegram chat ID (single-user app — first user in DB)
    const owner = await prisma.user.findFirst({
      where: { telegramId: { not: null } },
    });

    if (owner?.telegramId) {
      await sendTelegram(owner.telegramId, notifText);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("GHL Webhook Error:", error);
    return NextResponse.json({ ok: true });
  }
}
