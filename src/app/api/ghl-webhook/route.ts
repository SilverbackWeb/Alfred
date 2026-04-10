import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const contentType = req.headers.get("content-type") || "";
    let body: Record<string, unknown> = {};

    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      const text = await req.text();
      try { body = JSON.parse(text); } catch {
        const params = new URLSearchParams(text);
        params.forEach((v, k) => { body[k] = v; });
      }
    }

    const customData = (body.customData as Record<string, unknown>) || {};
    const message = (body.message as Record<string, unknown>) || {};

    const senderName = String(
      customData.contact_name || body.full_name ||
      `${body.first_name || ""} ${body.last_name || ""}`.trim() ||
      body.email || "Unknown"
    );

    const senderEmail = String(body.email || customData.email || "").trim();
    const contactId = String(body.contact_id || body.contactId || "").trim();
    const rawBody = String(customData.message_body || message.body || "").trim();
    const subject = String(body.subject || customData.subject || "").trim();

    // messageType can be passed as a custom field from GHL workflow
    const messageType = String(customData.message_type || body.messageType || body.message_type || "").toLowerCase();
    const isEmail = messageType.includes("email") || subject.length > 0;
    const typeLabel = isEmail ? "Email" : "Text";

    // Nothing to notify about
    if (!rawBody && !subject) {
      return NextResponse.json({ ok: true });
    }

    // Build clean notification (no emojis per user preference)
    let notifText = `${typeLabel} from ${senderName}`;
    if (isEmail && subject) notifText += `\nSubject: ${subject}`;
    if (rawBody) notifText += `\n\n${rawBody.slice(0, 500)}`;

    const owner = await prisma.user.findFirst({ where: { telegramId: { not: null } } });
    if (!owner) return NextResponse.json({ ok: true });

    // Send Telegram notification
    await sendTelegram(owner.telegramId!, notifText);

    // Save to Alfred's conversation memory so he knows the full context when you reply
    // This means "reply to Kelly" will use the right contact, email, and message
    const memoryEntry = `[Incoming ${typeLabel}] From: ${senderName}${senderEmail ? ` <${senderEmail}>` : ""}${contactId ? ` (GHL contact_id: ${contactId})` : ""}${subject ? ` | Subject: ${subject}` : ""} | Message: "${rawBody}"`;

    await prisma.message.create({
      data: {
        role: "assistant",
        content: memoryEntry,
        userId: owner.id,
      },
    });

  } catch (error) {
    console.error("GHL Webhook Error:", error);
  }

  return NextResponse.json({ ok: true });
}
