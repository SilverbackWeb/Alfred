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
    const rawBody = String(customData.message_body || message.body || "").trim();
    const subject = String(body.subject || customData.subject || "").trim();

    // Type is determined by the URL param set in GHL workflow — reliable, not guessed
    const isEmail = typeParam === "email";
    const typeLabel = isEmail ? "Email" : "Text";

    if (!rawBody && !subject) {
      return NextResponse.json({ ok: true });
    }

    const owner = await prisma.user.findFirst({ where: { telegramId: { not: null } } });
    if (!owner) return NextResponse.json({ ok: true });

    // Save to conversation memory so Alfred knows full context when you reply
    const memoryEntry = `[Incoming ${typeLabel}] From: ${senderName}${senderEmail ? ` <${senderEmail}>` : ""}${contactId ? ` (GHL contact_id: ${contactId})` : ""}${subject ? ` | Subject: ${subject}` : ""} | Message: "${rawBody}"`;

    await prisma.message.create({
      data: { role: "assistant", content: memoryEntry, userId: owner.id },
    });

    // One AI call does both: pull out the actual human message (dropping
    // headers/signatures/footers/quoted threads) and draft a reply.
    // Regex signature-stripping doesn't generalize across senders — an LLM does.
    let cleanMessage = rawBody;
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
        prompt: `Raw incoming ${typeLabel.toLowerCase()}:\n${isEmail && subject ? `Subject: ${subject}\n` : ""}${rawBody}`,
      });
      cleanMessage = object.cleanMessage.trim() || rawBody;
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
