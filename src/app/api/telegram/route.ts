// @ts-nocheck
import { NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { listUserRepos, searchUserRepos, getRepoIssues, getGitHubNotifications } from "@/lib/github";
import { sendSlackMessage, listSlackChannels } from "@/lib/slack";
import { draftEmail, sendEmail, searchEmails, getUpcomingEvents, createCalendarEvent, createGoogleDoc } from "@/lib/google";
import { searchContacts, createContact, updateContact, getPipelineDeals, updateOpportunity, sendSMS } from "@/lib/gohighlevel";
import { getDocumentProxy, extractText } from "unpdf";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// Load Alfred's personality from the persona file at startup
const ALFRED_PERSONA = (() => {
  try {
    return fs.readFileSync(path.join(process.cwd(), "ALFRED_PERSONA.md"), "utf-8");
  } catch {
    return "You are Alfred, a sharp personal assistant. Be concise and direct.";
  }
})();

async function sendMessage(chatId: number, text: string) {
  if (!TELEGRAM_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function handlePdf(message: any, chatId: number) {
  await sendMessage(chatId, "📄 Got your PDF. Extracting tasks...");

  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${message.document.file_id}`
    );
    const fileData = await fileRes.json();
    const filePath = fileData.result.file_path;

    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`
    );
    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text: rawText } = await extractText(pdf, { mergePages: true });
    const text = rawText.trim();

    if (!text) {
      await sendMessage(chatId, "❌ Couldn't extract text from that PDF. Is it a scanned image?");
      return;
    }

    const { text: aiResponse } = await generateText({
      model: openai("gpt-4o-mini"),
      system: `You extract tasks, ideas, and action items from documents.
Return ONLY a valid JSON array with no extra text.
Each item must have: {"title": string, "description": string, "priority": "LOW"|"MEDIUM"|"HIGH", "category": "PERSONAL"|"BUSINESS"|"IDEA"}
Be thorough — capture everything actionable. Assign priorities intelligently.`,
      prompt: `Extract all tasks and action items from this document:\n\n${text.slice(0, 8000)}`,
    });

    let tasks = [];
    try {
      const match = aiResponse.match(/\[[\s\S]*\]/);
      tasks = JSON.parse(match ? match[0] : aiResponse);
    } catch {
      await sendMessage(chatId, "❌ Couldn't parse tasks from the PDF. Try a cleaner document.");
      return;
    }

    if (!tasks.length) {
      await sendMessage(chatId, "🤔 No tasks found in that PDF.");
      return;
    }

    const user = await prisma.user.upsert({
      where: { telegramId: chatId.toString() },
      update: {},
      create: { telegramId: chatId.toString(), name: message.chat.first_name || "User" },
    });

    await prisma.task.createMany({
      data: tasks.map((t: any) => ({
        title: t.title,
        description: t.description || "",
        priority: ["LOW", "MEDIUM", "HIGH"].includes(t.priority) ? t.priority : "MEDIUM",
        category: ["PERSONAL", "BUSINESS", "IDEA"].includes(t.category) ? t.category : "PERSONAL",
        status: "BACKLOG",
        userId: user.id,
      })),
    });

    await sendMessage(chatId, `✅ Added ${tasks.length} tasks to your Vault from the PDF. Check your dashboard!`);
  } catch (error) {
    console.error("PDF Error:", error);
    await sendMessage(chatId, "❌ Something went wrong processing the PDF. Try again.");
  }
}

export async function POST(req: Request) {
  try {
    // Verify request is from Telegram using the webhook secret token
    const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (!incomingSecret || incomingSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const message = body.message;
    if (!message) return NextResponse.json({ ok: true });

    const chatId = message.chat.id;

    // Handle PDF uploads
    if (message.document?.mime_type === "application/pdf") {
      await handlePdf(message, chatId);
      return NextResponse.json({ ok: true });
    }

    if (!message.text) {
      await sendMessage(chatId, "I can handle text messages and PDF files. Send me a PDF to extract tasks, or just type a message!");
      return NextResponse.json({ ok: true });
    }

    const userText = message.text;

    // Load user record + last 20 messages for conversation history
    const userRecord = await prisma.user.upsert({
      where: { telegramId: chatId.toString() },
      update: {},
      create: { telegramId: chatId.toString(), name: message.chat.first_name || "User" },
    });

    const history = await prisma.message.findMany({
      where: { userId: userRecord.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const historyMessages = history.reverse().map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Save incoming user message
    await prisma.message.create({
      data: { role: "user", content: userText, userId: userRecord.id },
    });

    // Hard-coded confirmation detection — bypass AI entirely for send confirmations
    const confirmWords = /^(yes|send it|go ahead|do it|looks good|confirmed|send|yep|yup|ok send it|yes send it|send that|send the email)[\s!.]*$/i;
    if (confirmWords.test(userText.trim())) {
      // Re-fetch fresh from DB — avoids Vercel connection pool returning stale data
      const freshUser = await prisma.user.findUnique({ where: { telegramId: chatId.toString() } });
      if (freshUser?.lastDraftTo && freshUser?.lastDraftSubject && freshUser?.lastDraftBody) {
        const result = await sendEmail(freshUser.lastDraftTo, freshUser.lastDraftSubject, freshUser.lastDraftBody);
        await prisma.user.update({
          where: { telegramId: chatId.toString() },
          data: { lastDraftTo: null, lastDraftSubject: null, lastDraftBody: null },
        });
        const reply = "error" in result
          ? `❌ Failed to send: ${result.error}`
          : `Sent to ${freshUser.lastDraftTo}.`;
        await sendMessage(chatId, reply);
        await prisma.message.create({ data: { role: "assistant", content: reply, userId: userRecord.id } });
        return NextResponse.json({ ok: true });
      }
    }

    // Build system prompt: base persona + learned preferences
    const prefs: string[] = userRecord.preferences ? JSON.parse(userRecord.preferences) : [];
    const prefsBlock = prefs.length > 0
      ? `\n\n## User Preferences (learned — follow these strictly)\n${prefs.map((p) => `- ${p}`).join("\n")}`
      : "";

    const systemPrompt = `${ALFRED_PERSONA}${prefsBlock}

---

## Capabilities
You have access to: Digital Brain (tasks), Gmail, Google Calendar, Google Docs, GoHighLevel CRM, GitHub, Slack.

## Capability Rules
- **MEMORY**: Full conversation history is injected with every message. Use it. Never say you don't know what was just discussed.
- **ANTI-CLUTTER**: If a task sounds like a "maybe" or "someday", set isBacklog: true.
- **TIME AWARENESS**: If the user mentions a time or date, set the dueDate.
- **SEARCH BEFORE CREATING**: If the user asks about something, search the Vault first.
- **DELEGATION**: When asked what you can take off their plate, use reviewTasksForDelegation then executeAgentTask.
- **ALL EMAILS go through draftEmail first** — always preview before sending. Never skip the draft step.
- **DRAFT DISPLAY**: When draftEmail returns, show the full email:
  ✉️ Draft ready — reply "send it" to send or tell me what to change.
  To: [to] / Subject: [subject]
  [body]
- **SEND CONFIRMATION**: If user confirms after a draft, call sendLastDraft immediately.`;

    const { text: replyText } = await generateText({
      model: openai("gpt-4o-mini", { structuredOutputs: false }),
      system: systemPrompt,
      messages: [
        ...historyMessages,
        { role: "user" as const, content: userText },
      ],
      maxSteps: 10,
      tools: {
        // ── TASK TOOLS ────────────────────────────────────────────────────────
        createTask: tool({
          description: "Create a new task. Use isBacklog: true for ideas or low-priority items.",
          parameters: z.object({
            title: z.string(),
            description: z.string().optional(),
            priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
            isAgent: z.boolean(),
            isBacklog: z.boolean(),
            category: z.enum(["PERSONAL", "BUSINESS", "IDEA"]),
            dueDate: z.string().optional().describe("ISO date string if mentioned"),
          }),
          execute: async ({ title, description, priority, isAgent, isBacklog, category, dueDate }) => {
            let status = "TODO";
            if (isBacklog) status = "BACKLOG";
            else if (isAgent) status = "AGENT_WORKING";

            const task = await prisma.task.create({
              data: {
                title,
                description: description || "",
                priority,
                status,
                category,
                dueDate: dueDate ? new Date(dueDate) : null,
                user: {
                  connectOrCreate: {
                    where: { telegramId: chatId.toString() },
                    create: { telegramId: chatId.toString(), name: message.chat.first_name || "User" },
                  },
                },
              },
            });
            return { success: true, taskId: task.id, status };
          },
        }),

        getVaultTasks: tool({
          description: "List all tasks in the Vault (backlog/ideas). Use when the user asks what's in their vault or backlog.",
          parameters: z.object({}),
          execute: async () => {
            const results = await prisma.task.findMany({
              where: { status: "BACKLOG" },
              orderBy: [{ category: "asc" }, { priority: "asc" }],
            });
            return results.map((t) => ({ id: t.id, title: t.title, category: t.category, priority: t.priority }));
          },
        }),

        searchVault: tool({
          description: "Search the Vault/Backlog for a specific keyword or topic.",
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            const results = await prisma.task.findMany({
              where: {
                status: "BACKLOG",
                OR: [
                  { title: { contains: query, mode: "insensitive" } },
                  { description: { contains: query, mode: "insensitive" } },
                ],
              },
              take: 10,
            });
            return results.map((t) => ({ id: t.id, title: t.title, category: t.category }));
          },
        }),

        updateTask: tool({
          description: "Update an existing task's priority, due date, or status.",
          parameters: z.object({
            title: z.string().describe("Part of the title to find the task"),
            priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
            dueDate: z.string().optional().describe("ISO date string"),
            status: z.enum(["TODO", "IN_PROGRESS", "DONE", "BACKLOG"]).optional(),
          }),
          execute: async ({ title, priority, dueDate, status }) => {
            const task = await prisma.task.findFirst({
              where: { title: { contains: title, mode: "insensitive" }, user: { telegramId: chatId.toString() } },
            });
            if (!task) return { success: false, reason: "Task not found" };

            const updated = await prisma.task.update({
              where: { id: task.id },
              data: {
                ...(priority && { priority }),
                ...(dueDate && { dueDate: new Date(dueDate) }),
                ...(status && { status }),
              },
            });
            return { success: true, updated: updated.title };
          },
        }),

        getPendingTasks: tool({
          description: "List the user's currently pending tasks (TODO or IN_PROGRESS).",
          parameters: z.object({}),
          execute: async () => {
            const tasks = await prisma.task.findMany({
              where: {
                status: { in: ["TODO", "IN_PROGRESS", "AGENT_WORKING"] },
                user: { telegramId: chatId.toString() },
              },
              orderBy: { priority: "asc" },
            });
            return tasks.map((t) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              priority: t.priority,
              status: t.status,
              dueDate: t.dueDate,
            }));
          },
        }),

        markTaskDone: tool({
          description: "Mark a task as completed/DONE.",
          parameters: z.object({ title: z.string() }),
          execute: async ({ title }) => {
            const task = await prisma.task.findFirst({
              where: { title: { contains: title, mode: "insensitive" }, user: { telegramId: chatId.toString() } },
            });
            if (task) {
              await prisma.task.update({ where: { id: task.id }, data: { status: "DONE" } });
              return { success: true, updated: task.title };
            }
            return { success: false, reason: "Task not found" };
          },
        }),

        // ── AGENT DELEGATION TOOLS ────────────────────────────────────────────
        reviewTasksForDelegation: tool({
          description: "Analyze the user's TODO tasks and classify which ones Alfred can handle autonomously (draft, research, slack message) vs which need the human.",
          parameters: z.object({}),
          execute: async () => {
            const tasks = await prisma.task.findMany({
              where: {
                status: { in: ["TODO", "IN_PROGRESS"] },
                user: { telegramId: chatId.toString() },
              },
            });
            // Return raw tasks — the AI will classify them in its response
            return tasks.map((t) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              category: t.category,
              priority: t.priority,
            }));
          },
        }),

        executeAgentTask: tool({
          description: "Execute a task autonomously. Move it to AGENT_WORKING, do the work, store the result, mark DONE.",
          parameters: z.object({
            taskId: z.string().describe("The task ID to execute"),
            taskType: z.enum(["draft", "research", "slack"]),
            slackChannel: z.string().optional().describe("Slack channel name (without #) — required for slack taskType"),
          }),
          execute: async ({ taskId, taskType, slackChannel }) => {
            const task = await prisma.task.findUnique({ where: { id: taskId } });
            if (!task) return { success: false, reason: "Task not found" };

            // Mark as AGENT_WORKING immediately
            await prisma.task.update({ where: { id: taskId }, data: { status: "AGENT_WORKING" } });

            let result = "";

            if (taskType === "draft") {
              const { text } = await generateText({
                model: openai("gpt-4o-mini"),
                system: "You are a professional writer. Write clear, concise, professional content.",
                prompt: `Write a complete draft for this task:\nTitle: ${task.title}\nDescription: ${task.description || "No additional details"}\n\nProduce the full draft content ready to use.`,
              });
              result = text;
            }

            else if (taskType === "research") {
              const { text } = await generateText({
                model: openai("gpt-4o-mini"),
                system: "You are a sharp research analyst. Be concise, factual, and actionable.",
                prompt: `Research and summarize this topic:\nTitle: ${task.title}\nContext: ${task.description || "No additional context"}\n\nProvide a clear, structured summary with key insights and recommended next steps.`,
              });
              result = text;
            }

            else if (taskType === "slack") {
              const channel = slackChannel || "general";
              const messageText = `📋 *${task.title}*\n${task.description || ""}`;
              const slackResult = await sendSlackMessage(channel, messageText);
              if ("error" in slackResult) {
                await prisma.task.update({ where: { id: taskId }, data: { status: "TODO" } });
                return { success: false, reason: slackResult.error };
              }
              result = `Slack message sent to #${channel}`;
            }

            // Store result and mark DONE
            await prisma.task.update({
              where: { id: taskId },
              data: { status: "DONE", result },
            });

            return { success: true, taskTitle: task.title, taskType, resultPreview: result.slice(0, 200) };
          },
        }),

        sendSlackMessage: tool({
          description: "Send a Slack message to a channel on behalf of the user.",
          parameters: z.object({
            channel: z.string().describe("Channel name without # (e.g. 'general')"),
            message: z.string().describe("The message to send"),
          }),
          execute: async ({ channel, message }) => {
            return await sendSlackMessage(channel, message);
          },
        }),

        listSlackChannels: tool({
          description: "List available Slack channels the bot has access to.",
          parameters: z.object({}),
          execute: async () => {
            return await listSlackChannels();
          },
        }),

        // ── GITHUB TOOLS ─────────────────────────────────────────────────────
        listGitHubRepos: tool({
          description: "List all GitHub repositories for the authenticated user.",
          parameters: z.object({}),
          execute: async () => {
            return await listUserRepos();
          },
        }),

        searchGitHubRepos: tool({
          description: "Search for a specific GitHub repository by name or keyword.",
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            return await searchUserRepos(query);
          },
        }),

        getGitHubIssues: tool({
          description: "Fetch open issues for a specific GitHub repository.",
          parameters: z.object({
            owner: z.string().describe("Owner of the repo (e.g., 'SilverbackWeb')"),
            repo: z.string().describe("Name of the repo (e.g., 'Alfred')"),
          }),
          execute: async ({ owner, repo }) => {
            return await getRepoIssues(owner, repo);
          },
        }),

        getGitHubActivity: tool({
          description: "Check for recent GitHub notifications or mentions.",
          parameters: z.object({}),
          execute: async () => {
            return await getGitHubNotifications();
          },
        }),

        // ── GOOGLE TOOLS ──────────────────────────────────────────────────────
        draftEmail: tool({
          description: "Write and preview an email — use this for ALL email requests whether user says 'draft', 'write', 'send', or 'email someone'. Always show the preview first. Never send without confirmation.",
          parameters: z.object({
            to: z.string().describe("Recipient email address"),
            subject: z.string(),
            body: z.string().describe("Plain text email body"),
          }),
          execute: async ({ to, subject, body }) => {
            // Save draft details to user record so "send it" works later
            await prisma.user.upsert({
              where: { telegramId: chatId.toString() },
              update: { lastDraftTo: to, lastDraftSubject: subject, lastDraftBody: body },
              create: { telegramId: chatId.toString(), name: message.chat.first_name || "User", lastDraftTo: to, lastDraftSubject: subject, lastDraftBody: body },
            });
            await draftEmail(to, subject, body);
            // Return the full draft for display in Telegram — no link needed
            return { to, subject, body, preview: true };
          },
        }),

        sendLastDraft: tool({
          description: "ALWAYS call this tool when the user says 'send it', 'yes', 'send', 'go ahead', 'looks good', or any short confirmation after seeing a draft. Do NOT reply with text — call this tool immediately.",
          parameters: z.object({}),
          execute: async () => {
            const user = await prisma.user.findUnique({ where: { telegramId: chatId.toString() } });
            if (!user?.lastDraftTo || !user?.lastDraftSubject || !user?.lastDraftBody) {
              return { error: "No draft found. Please ask me to draft an email first." };
            }
            const result = await sendEmail(user.lastDraftTo, user.lastDraftSubject, user.lastDraftBody);
            // Clear the draft after sending
            await prisma.user.update({
              where: { telegramId: chatId.toString() },
              data: { lastDraftTo: null, lastDraftSubject: null, lastDraftBody: null },
            });
            return result;
          },
        }),


        searchEmails: tool({
          description: "Search Gmail inbox using Gmail search syntax (from:, subject:, is:unread, etc.).",
          parameters: z.object({
            query: z.string().describe("Gmail search query e.g. 'from:john@example.com is:unread'"),
          }),
          execute: async ({ query }) => {
            return await searchEmails(query);
          },
        }),

        getCalendar: tool({
          description: "Get upcoming calendar events for the next N days.",
          parameters: z.object({
            days: z.number().default(7).describe("Number of days ahead to check"),
          }),
          execute: async ({ days }) => {
            return await getUpcomingEvents(days);
          },
        }),

        createCalendarEvent: tool({
          description: "Create a new event on the user's Google Calendar.",
          parameters: z.object({
            title: z.string(),
            start: z.string().describe("ISO 8601 datetime e.g. '2025-04-10T14:00:00-05:00'"),
            end: z.string().describe("ISO 8601 datetime"),
            description: z.string().optional(),
          }),
          execute: async ({ title, start, end, description }) => {
            return await createCalendarEvent(title, start, end, description);
          },
        }),

        createGoogleDoc: tool({
          description: "Create a Google Doc with title and content. Use when user says 'write up', 'document', 'create a doc'.",
          parameters: z.object({
            title: z.string(),
            content: z.string().describe("Plain text content for the document"),
          }),
          execute: async ({ title, content }) => {
            return await createGoogleDoc(title, content);
          },
        }),

        // ── GOHIGHLEVEL CRM TOOLS ─────────────────────────────────────────────
        searchCRMContacts: tool({
          description: "Search GoHighLevel CRM contacts by name, email, or phone.",
          parameters: z.object({
            query: z.string().describe("Name, email, or phone to search for"),
          }),
          execute: async ({ query }) => {
            return await searchContacts(query);
          },
        }),

        createCRMContact: tool({
          description: "Add a new contact/lead to GoHighLevel CRM.",
          parameters: z.object({
            firstName: z.string(),
            lastName: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            tags: z.array(z.string()).optional(),
          }),
          execute: async ({ firstName, lastName, email, phone, tags }) => {
            return await createContact({ firstName, lastName, email, phone, tags });
          },
        }),

        updateCRMContact: tool({
          description: "Update an existing GoHighLevel contact by their contact ID.",
          parameters: z.object({
            contactId: z.string(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            tags: z.array(z.string()).optional(),
          }),
          execute: async ({ contactId, ...fields }) => {
            return await updateContact(contactId, fields);
          },
        }),

        getPipeline: tool({
          description: "Check the GoHighLevel sales pipeline and see where deals stand.",
          parameters: z.object({
            pipelineId: z.string().optional().describe("Specific pipeline ID — omit to get all deals"),
          }),
          execute: async ({ pipelineId }) => {
            const deals = await getPipelineDeals(pipelineId);
            // Save pipeline results so Alfred can reference them in follow-up messages
            if (Array.isArray(deals)) {
              await prisma.user.upsert({
                where: { telegramId: chatId.toString() },
                update: { lastPipeline: JSON.stringify(deals) },
                create: { telegramId: chatId.toString(), name: message.chat.first_name || "User", lastPipeline: JSON.stringify(deals) },
              });
            }
            return deals;
          },
        }),

        updateOpportunity: tool({
          description: "Update a GHL opportunity/deal status (open, won, lost, abandoned) or value. Use getPipeline first to find the opportunity ID.",
          parameters: z.object({
            opportunityId: z.string().describe("The GHL opportunity ID"),
            status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
            monetaryValue: z.number().optional(),
            name: z.string().optional(),
          }),
          execute: async ({ opportunityId, status, monetaryValue, name }) => {
            return await updateOpportunity(opportunityId, { status, monetaryValue, name });
          },
        }),

        sendSMSToContact: tool({
          description: "Send an SMS to a GoHighLevel contact by their contact ID.",
          parameters: z.object({
            contactId: z.string().describe("The GHL contact ID (use searchCRMContacts first to find it)"),
            message: z.string(),
          }),
          execute: async ({ contactId, message }) => {
            return await sendSMS(contactId, message);
          },
        }),

        // ── MEMORY / PREFERENCE TOOLS ─────────────────────────────────────────
        rememberPreference: tool({
          description: "Save a user preference or personal fact that Alfred should always remember. Use when the user says 'remember', 'always', 'never', 'I prefer', 'from now on', etc.",
          parameters: z.object({
            preference: z.string().describe("The preference to remember, written as a clear instruction. e.g. 'Always give calendar answers as a single event, not a list'"),
          }),
          execute: async ({ preference }) => {
            const prefs: string[] = userRecord.preferences ? JSON.parse(userRecord.preferences) : [];
            prefs.push(preference);
            await prisma.user.update({
              where: { id: userRecord.id },
              data: { preferences: JSON.stringify(prefs) },
            });
            return { saved: true, preference, totalPreferences: prefs.length };
          },
        }),

        forgetPreference: tool({
          description: "Remove a previously saved user preference. Use when the user says 'forget that', 'stop doing X', 'ignore that rule'.",
          parameters: z.object({
            keyword: z.string().describe("A keyword to match against stored preferences to find and remove the right one"),
          }),
          execute: async ({ keyword }) => {
            const prefs: string[] = userRecord.preferences ? JSON.parse(userRecord.preferences) : [];
            const before = prefs.length;
            const updated = prefs.filter((p) => !p.toLowerCase().includes(keyword.toLowerCase()));
            await prisma.user.update({
              where: { id: userRecord.id },
              data: { preferences: JSON.stringify(updated) },
            });
            return { removed: before - updated.length, remaining: updated.length };
          },
        }),

        listPreferences: tool({
          description: "Show all saved user preferences. Use when the user asks 'what do you remember about me?' or 'what are my preferences?'",
          parameters: z.object({}),
          execute: async () => {
            const prefs: string[] = userRecord.preferences ? JSON.parse(userRecord.preferences) : [];
            return prefs.length > 0 ? { preferences: prefs } : { preferences: [], note: "Nothing saved yet." };
          },
        }),
      },
    });

    if (replyText) {
      await sendMessage(chatId, replyText);
      // Save Alfred's reply to conversation history
      await prisma.message.create({
        data: { role: "assistant", content: replyText, userId: userRecord.id },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Logic Error:", error);
    return NextResponse.json({ ok: true });
  }
}
