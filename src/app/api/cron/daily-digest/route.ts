import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUnrepliedConversations } from "@/lib/gohighlevel";
import { searchEmails } from "@/lib/google";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

async function sendTelegram(chatId: string, text: string) {
  if (!TELEGRAM_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function GET(req: Request) {
  // Verify this is called by Vercel cron (not a random visitor)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Only run on weekdays (Vercel cron doesn't support weekday-only natively)
  const day = new Date().getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) {
    return NextResponse.json({ ok: true, skipped: "weekend" });
  }

  const owner = await prisma.user.findFirst({ where: { telegramId: { not: null } } });
  if (!owner?.telegramId) return NextResponse.json({ ok: true });

  const lines: string[] = ["End of day — things that need a reply:"];
  let hasAnything = false;

  // GHL unreplied conversations
  try {
    const conversations = await getUnrepliedConversations();
    if (conversations.length > 0) {
      hasAnything = true;
      lines.push("\nGHL Messages:");
      for (const c of conversations) {
        const type = c.type?.toLowerCase().includes("email") ? "Email" : "Text";
        lines.push(`- ${c.contact} (${type}): "${c.lastMessage}"`);
      }
    }
  } catch (e) {
    console.error("Daily digest GHL error:", e);
  }

  // Unread Gmail
  try {
    const emails = await searchEmails("is:unread is:inbox");
    if (Array.isArray(emails) && emails.length > 0) {
      hasAnything = true;
      lines.push(`\nUnread Gmail (${emails.length}):`);
      for (const e of emails.slice(0, 10)) {
        lines.push(`- From ${e.from}: "${e.subject}"`);
      }
      if (emails.length > 10) lines.push(`  ...and ${emails.length - 10} more`);
    }
  } catch (e) {
    console.error("Daily digest Gmail error:", e);
  }

  if (!hasAnything) {
    lines.push("\nAll clear — inbox zero.");
  }

  await sendTelegram(owner.telegramId, lines.join("\n"));

  return NextResponse.json({ ok: true });
}
