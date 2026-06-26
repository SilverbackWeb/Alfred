import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import fs from "fs";
import path from "path";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const ALFRED_PERSONA = (() => {
  try { return fs.readFileSync(path.join(process.cwd(), "ALFRED_PERSONA.md"), "utf-8"); } catch { return ""; }
})();

const CLIENT_CONTEXT = (() => {
  try { return fs.readFileSync(path.join(process.cwd(), "CLIENT_CONTEXT.md"), "utf-8"); } catch { return ""; }
})();

function getTextValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getTextValues(...values: unknown[]) {
  return values.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
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
    return quotePatterns.some((pattern) => pattern.test(trimmed));
  });

  return (cutAt >= 0 ? lines.slice(0, cutAt).join("\n") : text).trim();
}

// Used only to score candidates in chooseEmailBody below — NOT used for the
// text shown to Mike or sent to the AI. Per-client signature regexes don't
// generalize; the AI extraction step (in POST) handles that for display.
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

// Same pipeline as cleanIncomingEmail but without signature-stripping — this is
// what gets handed to the AI extraction step, which strips signatures itself.
function prepIncomingText(rawBody: string) {
  const text = /<\/?[a-z][\s\S]*>/i.test(rawBody) ? htmlToText(rawBody) : rawBody;
  return normalizeWhitespace(stripQuotedHistory(normalizeWhitespace(text)));
}

function isHeaderOnly(text: string) {
  const cleaned = normalizeWhitespace(text);
  const lines = cleaned.split("\n").filter(Boolean);
  if (!lines.length) return true;
  if (lines.length > 3) return false;

  return lines.every((line) =>
    /^(from|to|cc|bcc|sent|date|subject|message):\s*/i.test(line) ||
    /^["']?[^<>"']+["']?\s*<[^@\s]+@[^>\s]+>[:,]?$/i.test(line) ||
    /^["']?[^@\s]+@[^@\s]+\.[^@\s"']+["']?[:,]?$/i.test(line)
  );
}

function emailAddressCount(text: string) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.length || 0;
}

// Picks the best of several candidate body fields (GHL sends the same message
// across multiple keys — html, text, customData — and some are just headers
// or forwarded-thread noise). Scoring uses cleanIncomingEmail internally but
// the winning RAW candidate is what gets passed on for display/AI cleaning.
function chooseEmailBody(candidates: string[]) {
  let best = { raw: "", cleaned: "", score: Number.NEGATIVE_INFINITY };

  for (const raw of candidates) {
    const cleaned = cleanIncomingEmail(raw);
    if (!cleaned) continue;

    let score = Math.min(cleaned.length, 1200);
    if (isHeaderOnly(cleaned)) score -= 2000;
    score -= emailAddressCount(cleaned) * 125;
    if (/^begin forwarded message:/i.test(normalizeWhitespace(raw))) score -= 1000;
    if (/<\/?[a-z][\s\S]*>/i.test(raw)) score += 150;

    if (score > best.score) best = { raw, cleaned, score };
  }

  return best.cleaned ? best : { raw: getTextValue(...candidates), cleaned: "", score: 0 };
}

async function sendTelegram(chatId: string, text: string) {
  if (!TELEGRAM_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendTelegramWithButtons(
  chatId: string,
  text: string,
  buttons: { text: string; callback_data: string }[][]
) {
  if (!TELEGRAM_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: buttons } }),
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
    const bodyCandidates = getTextValues(
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

    const selectedEmailBody = isEmail ? chooseEmailBody(bodyCandidates) : null;
    const rawBody = isEmail ? selectedEmailBody!.raw : getTextValue(...bodyCandidates);
    const hasContent = isEmail ? Boolean(selectedEmailBody!.cleaned) : Boolean(normalizeWhitespace(rawBody));

    if (!hasContent && !subject) {
      return NextResponse.json({ ok: true });
    }

    // Deterministic prep (HTML decode + quoted-thread strip), then the AI
    // pulls out the actual human message and drafts a reply in one call.
    const preppedText = isEmail ? prepIncomingText(rawBody) : normalizeWhitespace(rawBody);

    // Save to conversation memory so Alfred knows full context when you reply
    const memoryEntry = `[Incoming ${typeLabel}] From: ${senderName}${senderEmail ? ` <${senderEmail}>` : ""}${contactId ? ` (GHL contact_id: ${contactId})` : ""}${subject ? ` | Subject: ${subject}` : ""} | Message: "${preppedText}"`;

    await prisma.message.create({
      data: { role: "assistant", content: memoryEntry, userId: owner.id },
    });

    // One AI call does both: pull out the actual human message (dropping
    // headers/signatures/footers/quoted threads) and draft a reply.
    // Regex signature-stripping doesn't generalize across senders — an LLM does.
    let cleanMessage = preppedText;
    let draftBody = "";
    let draftSubject = subject ? `Re: ${subject}` : "";
    try {
      const contextBlock = CLIENT_CONTEXT ? `\n\n${CLIENT_CONTEXT}` : "";
      const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: z.object({
          cleanMessage: z
            .string()
            .describe(
              "Just the actual human-written message content — keep the sender's own greeting/sign-off if they wrote one, but strip email signatures, job titles, contact info blocks, legal disclaimers, unsubscribe links, and quoted/forwarded message threads."
            ),
          draftReply: z
            .string()
            .describe(
              "A suggested reply body on behalf of Mike Satterfield. No greeting line, no subject line, no signature — just the body text. Concise, professional, human, matching the tone of the incoming message."
            ),
        }),
        system: `${ALFRED_PERSONA}${contextBlock}

You are processing an incoming ${typeLabel.toLowerCase()} on behalf of Mike Satterfield (mike@silverbackweb.com) from ${senderName}.`,
        prompt: `Raw incoming ${typeLabel.toLowerCase()}:\n${isEmail && subject ? `Subject: ${subject}\n` : ""}${preppedText}`,
      });
      cleanMessage = object.cleanMessage.trim() || preppedText;
      draftBody = object.draftReply.trim();
    } catch (e) {
      console.error("Email extraction/draft generation error:", e);
    }

    // SMS-style single-line notification — no headers, no signature, no footer.
    const notifText = `${typeLabel} from ${senderName}: "${cleanMessage.slice(0, 500)}"`;

    if (draftBody) {
      // Save draft so Send button works immediately
      const channel = isEmail ? "ghl_email" : "ghl_sms";
      await prisma.user.update({
        where: { id: owner.id },
        data: {
          lastDraftTo: senderName,
          lastDraftSubject: draftSubject,
          lastDraftBody: draftBody,
          lastDraftContactId: contactId || null,
          lastDraftChannel: channel,
        },
      });

      // Save draft to memory so Edit flow has context
      await prisma.message.create({
        data: { role: "assistant", content: `[Suggested Reply Draft]\n${draftBody}`, userId: owner.id },
      });

      const draftPreview = `${notifText}\n\n---\nSuggested reply:\n\n${draftBody}`;

      await sendTelegramWithButtons(owner.telegramId!, draftPreview, [
        [
          { text: "Send", callback_data: "send_draft" },
          { text: "Edit", callback_data: "edit_draft" },
          { text: "Cancel", callback_data: "cancel_draft" },
        ],
      ]);
    } else {
      // Fallback to plain notification if draft generation failed
      await sendTelegram(owner.telegramId!, notifText);
    }

  } catch (error) {
    console.error("GHL Webhook Error:", error);
  }

  return NextResponse.json({ ok: true });
}
