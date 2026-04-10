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

  // DEBUG: confirm chatId and parsed values
  if (chatId) {
    const customData = (body.customData as Record<string, unknown>) || {};
    const message = (body.message as Record<string, unknown>) || {};
    const senderName = (customData.contact_name || body.full_name || "Unknown") as string;
    const rawBody = String(customData.message_body || message.body || "").trim();
    await sendTelegram(chatId, `[DEBUG2] chatId: ${chatId}\nsender: ${senderName}\nbody: "${rawBody}"`);
  } else {
    // No chatId found — log to console
    console.error("GHL webhook: no owner chatId found in DB");
  }

  return NextResponse.json({ ok: true });
}
