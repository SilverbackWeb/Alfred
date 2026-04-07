// @ts-nocheck
import { NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { listUserRepos, searchUserRepos, getRepoIssues, getGitHubNotifications } from "@/lib/github";
import { extractText, getDocumentProxy } from "unpdf";

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
    // Get file download path from Telegram
    const fileRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${message.document.file_id}`
    );
    const fileData = await fileRes.json();
    const filePath = fileData.result.file_path;

    // Download the file
    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`
    );
    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    // Extract text from PDF
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text: rawText } = await extractText(pdf, { mergePages: true });
    const text = rawText.trim();

    if (!text) {
      await sendMessage(chatId, "❌ Couldn't extract text from that PDF. Is it a scanned image?");
      return;
    }

    // Use AI to pull out tasks
    const { text: aiResponse } = await generateText({
      model: openai("gpt-4o-mini"),
      system: `You extract tasks, ideas, and action items from documents.
Return ONLY a valid JSON array with no extra text.
Each item must have: {"title": string, "description": string, "priority": "LOW"|"MEDIUM"|"HIGH", "category": "PERSONAL"|"BUSINESS"|"IDEA"}
Be thorough — capture everything actionable. Assign priorities intelligently.`,
      prompt: `Extract all tasks and action items from this document:\n\n${text.slice(0, 8000)}`,
    });

    // Parse JSON from AI response
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

    // Get or create user
    const user = await prisma.user.upsert({
      where: { telegramId: chatId.toString() },
      update: {},
      create: { telegramId: chatId.toString(), name: message.chat.first_name || "User" },
    });

    // Save all tasks to Vault (BACKLOG)
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

    await sendMessage(
      chatId,
      `✅ Added ${tasks.length} tasks to your Vault from the PDF. Check your dashboard!`
    );
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
      system: `You are the user's Power Personal Assistant. Your job is to stay organized and proactive.
You have access to their Digital Brain (database) via tools.
Use tools to create tasks, search the Vault, or update existing items.

RULES:
- **ANTI-CLUTTER**: If a task sounds like a "maybe," a "someday," or a random idea, set isBacklog: true.
- **TIME AWARENESS**: If the user mentions a time or date, set the dueDate.
- **SEARCH BEFORE CREATING**: If the user asks about something, search the Vault first.
- **GITHUB ASSISTANT**: You can list/search repositories, list issues, and check notifications for the user on GitHub (SilverbackWeb).
- **CONCISE**: Keep your responses short and punchy.`,
      prompt: userText,
      maxSteps: 5,
      tools: {
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
          description: "List all tasks in the Vault (backlog/ideas). Use this when the user asks what's in their vault or backlog.",
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
              where: { title: { contains: title }, user: { telegramId: chatId.toString() } },
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
              where: { title: { contains: title }, user: { telegramId: chatId.toString() } },
            });
            if (task) {
              await prisma.task.update({ where: { id: task.id }, data: { status: "DONE" } });
              return { success: true, updated: task.title };
            }
            return { success: false, reason: "Task not found" };
          },
        }),
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
