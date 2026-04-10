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
  let body: Record<string, unknown> = {};

  // GHL workflow webhooks can send JSON or form-encoded — handle both
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        // form-encoded fallback
        const params = new URLSearchParams(text);
        params.forEach((v, k) => { body[k] = v; });
      }
    }
  } catch (e) {
    console.error("GHL payload parse error:", e);
    return NextResponse.json({ ok: true });
  }

  const chatId = await getOwnerChatId();

  // DEBUG: send raw payload to Telegram so we can see the structure
  if (chatId) {
    await sendTelegram(chatId, `[GHL DEBUG]\n${JSON.stringify(body, null, 2).slice(0, 3000)}`);
  }

  try {
    // Extract contact info — GHL workflow webhooks nest data differently
    const contact = (body.contact as Record<string, unknown>) || {};
    const contactId = (body.contactId || contact.id || "") as string;

    let senderName = (
      body.contactName ||
      body.fullName ||
      contact.name ||
      `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
      contact.email ||
      contact.phone ||
      ""
    ) as string;

    if (!senderName && contactId) {
      const fetched = await getContactById(contactId);
      if (fetched?.name) senderName = fetched.name;
    }

    const rawBody = (body.body || body.message || body.messageBody || body.text || "") as string;
    const subject = (body.subject || body.emailSubject || "") as string;
    const messageType = (body.messageType || body.type || "") as string;

    const isEmail = messageType.toLowerCase().includes("email");
    const typeLabel = isEmail ? "📧 Email" : "📱 Text";

    let notifText = `${typeLabel} from ${senderName || "Unknown"}`;
    if (isEmail && subject) notifText += `\nSubject: ${subject}`;
    if (rawBody) notifText += `\n\n${rawBody.slice(0, 500)}`;

    // Only send the real notification if we have meaningful content
    if (rawBody || subject) {
      if (chatId) await sendTelegram(chatId, notifText);
    }
  } catch (error) {
    console.error("GHL Webhook processing error:", error);
  }

  return NextResponse.json({ ok: true });
}
