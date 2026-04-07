// @ts-nocheck
import { NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { listUserRepos, searchUserRepos, getRepoIssues, getGitHubNotifications } from "@/lib/github";
import { sendSlackMessage, listSlackChannels } from "@/lib/slack";
import { draftEmail, sendEmail, searchEmails, getUpcomingEvents, createCalendarEvent, createGoogleDoc } from "@/lib/google";
import { searchContacts, createContact, updateContact, getPipelineDeals, sendSMS } from "@/lib/gohighlevel";
import { getDocumentProxy, extractText } from "unpdf";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

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

    const { text: replyText } = await generateText({
      model: openai("gpt-4o-mini", { structuredOutputs: false }),
      system: `You are Alfred, the user's Power Personal Assistant — sharp, capable, and proactive.
You have access to their Digital Brain (task database), GitHub, and Slack via tools.

RULES:
- **ANTI-CLUTTER**: If a task sounds like a "maybe," a "someday," or a random idea, set isBacklog: true.
- **TIME AWARENESS**: If the user mentions a time or date, set the dueDate.
- **SEARCH BEFORE CREATING**: If the user asks about something, search the Vault first.
- **DELEGATION**: When the user asks what you can take off their plate, use reviewTasksForDelegation, then executeAgentTask for confirmed items.
- **GOOGLE WORKSPACE**: You can draft/send emails, search Gmail, check/create Calendar events, and create Google Docs.
- **EMAIL SAFETY**: Always use draftEmail unless the user explicitly says "send". Never send without confirmation.
- **GOHIGHLEVEL CRM**: You can search contacts, add new leads, update contacts, check the sales pipeline, and send SMS.
- **CONCISE**: Keep your responses short and punchy. You're a butler, not a chatbot.`,
      prompt: userText,
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
          description: "Create a Gmail draft. Use when user says 'draft', 'write', or 'prepare' an email. Default to this over sendEmail.",
          parameters: z.object({
            to: z.string().describe("Recipient email address"),
            subject: z.string(),
            body: z.string().describe("Plain text email body"),
          }),
          execute: async ({ to, subject, body }) => {
            return await draftEmail(to, subject, body);
          },
        }),

        sendEmail: tool({
          description: "Send an email immediately via Gmail. Only use when user explicitly says 'send' — default to draftEmail.",
          parameters: z.object({
            to: z.string().describe("Recipient email address"),
            subject: z.string(),
            body: z.string().describe("Plain text email body"),
          }),
          execute: async ({ to, subject, body }) => {
            return await sendEmail(to, subject, body);
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
            return await getPipelineDeals(pipelineId);
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
      },
    });

    if (replyText) {
      await sendMessage(chatId, replyText);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Logic Error:", error);
    return NextResponse.json({ ok: true });
  }
}
