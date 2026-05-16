import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

function getTextValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function decodeHtmlEntities(text: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[lower] || match;
  });
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
      .replace(/<div[^>]+(?:gmail_quote|yahoo_quoted|protonmail_quote)[\s\S]*?<\/div>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedHistory(text: string) {
  const lines = text.split("\n");
  const quotePatterns = [
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^On .+ wrote:$/i,
    /^From:\s.+/i,
    /^Sent:\s.+/i,
    /^To:\s.+/i,
    /^Subject:\s.+/i,
    /^Begin forwarded message:/i,
    /^Forwarded message/i,
    /^>+/,
  ];

  const cutAt = lines.findIndex((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (index === 0 && !trimmed.startsWith(">")) return false;
    return quotePatterns.some((pattern) => pattern.test(trimmed));
  });

  return (cutAt > 0 ? lines.slice(0, cutAt).join("\n") : text).trim();
}

function stripSignature(text: string) {
  const lines = text.split("\n");
  const cutPatterns = [
    /^--\s*$/,
    /^_{3,}$/,
    /^-{3,}$/,
    /^={3,}$/,
    /^(best|regards|sincerely|thank you|thanks|cheers),?$/i,
    /^(office|phone|cell|mobile|fax|tel)[\s:]/i,
    /^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/,
    /^(www\.|https?:\/\/)/i,
    /^(sent from my|sent via)/i,
    /linkedin\.com/i,
    /unsubscribe/i,
    /confidentiality notice/i,
    /^(attachments?|attached files?):/i,
    /,\s*[A-Z][A-Z.]{0,3}(,\s*[A-Z][A-Z.]{0,3})*\s*$/,
  ];

  const firstContentLine = lines.findIndex((line) => line.trim());
  const cutAt = lines.findIndex((line, index) => {
    if (index <= firstContentLine) return false;
    return cutPatterns.some((pattern) => pattern.test(line.trim()));
  });

  return (cutAt > 0 ? lines.slice(0, cutAt).join("\n") : text).trim();
}

function cleanIncomingEmail(rawBody: string) {
  const text = /<\/?[a-z][\s\S]*>/i.test(rawBody) ? htmlToText(rawBody) : rawBody;
  return normalizeWhitespace(stripSignature(stripQuotedHistory(normalizeWhitespace(text))));
}

function formatPreview(text: string, maxLength = 700) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

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
    const url = new URL(req.url);
    // GHL workflow sets ?type=email or ?type=sms in the webhook URL
    const typeParam = url.searchParams.get("type")?.toLowerCase() || "";

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
    const rawBody = getTextValue(
      customData.message_body,
      customData.html,
      customData.body,
      message.html,
      message.body,
      body.html,
      body.body,
      body.message_body
    );
    const subject = getTextValue(body.subject, customData.subject, message.subject);

    // Type is determined by the URL param set in GHL workflow — reliable, not guessed
    const isEmail = typeParam === "email";
    const typeLabel = isEmail ? "Email" : "Text";

    const owner = await prisma.user.findFirst({ where: { telegramId: { not: null } } });
    if (!owner) return NextResponse.json({ ok: true });

    const displayBody = isEmail ? cleanIncomingEmail(rawBody) : normalizeWhitespace(rawBody);

    if (!displayBody && !subject) {
      return NextResponse.json({ ok: true });
    }

    const ownerName = owner.name || "Mike";
    let notifText = isEmail
      ? `${ownerName}, ${senderName} sent you an email.`
      : `${ownerName}, ${senderName} sent you a text.`;
    if (isEmail && subject) notifText += `\nSubject: ${subject}`;
    if (displayBody) notifText += `\n\n"${formatPreview(displayBody)}"`;

    await sendTelegram(owner.telegramId!, notifText);

    // Save to conversation memory so Alfred knows full context when you reply
    const memoryEntry = `[Incoming ${typeLabel}] From: ${senderName}${senderEmail ? ` <${senderEmail}>` : ""}${contactId ? ` (GHL contact_id: ${contactId})` : ""}${subject ? ` | Subject: ${subject}` : ""} | Message: "${rawBody}"`;

    await prisma.message.create({
      data: { role: "assistant", content: memoryEntry, userId: owner.id },
    });

  } catch (error) {
    console.error("GHL Webhook Error:", error);
  }

  return NextResponse.json({ ok: true });
}
