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

async function getOwnerChatId(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { telegramId: { not: null } },
  });
  return owner?.telegramId ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // DEBUG: forward the raw payload so we can see what GHL actually sends
    const chatId = await getOwnerChatId();
    if (chatId) {
      await sendTelegram(chatId, `[GHL DEBUG] Raw payload:\n${JSON.stringify(body, null, 2).slice(0, 3000)}`);
    }

    const type: string = body.type || body.event || body.eventType || "";

    // Only process inbound messages
    if (!type.toLowerCase().includes("inbound")) {
      return NextResponse.json({ ok: true });
    }

    const messageType: string = body.messageType || body.type || "Message";
    const contactId: string | undefined = body.contactId || body.contact?.id;
    const rawBody: string = body.body || body.message?.body || body.text || "";
    const subject: string = body.subject || body.email?.subject || "";

    if (!rawBody && !subject) {
      return NextResponse.json({ ok: true });
    }

    // Look up contact name from GHL
    let senderName: string =
      body.contactName ||
      body.contact?.name ||
      `${body.contact?.firstName || ""} ${body.contact?.lastName || ""}`.trim() ||
      body.name ||
      "Unknown";

    if (contactId && (senderName === "Unknown" || senderName === "")) {
      const contact = await getContactById(contactId);
      if (contact?.name) senderName = contact.name;
    }

    // Build notification
    const isEmail = messageType.toLowerCase().includes("email");
    const isSMS = messageType.toLowerCase().includes("sms");
    const typeLabel = isEmail ? "📧 Email" : isSMS ? "📱 Text" : "💬 Message";

    let notifText = `${typeLabel} from ${senderName || "Unknown"}`;
    if (isEmail && subject) notifText += `\nSubject: ${subject}`;
    if (rawBody) notifText += `\n\n${rawBody.slice(0, 500)}`;
    if (rawBody.length > 500) notifText += "\n[...]";

    if (chatId) {
      await sendTelegram(chatId, notifText);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("GHL Webhook Error:", error);
    return NextResponse.json({ ok: true });
  }
}
