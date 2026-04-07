// @ts-nocheck
import { NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { listUserRepos, searchUserRepos, getRepoIssues, getGitHubNotifications } from "@/lib/github";


const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    const message = body.message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true }); 
    }

    const chatId = message.chat.id;
    const userText = message.text;

    // Use AI SDK to generate a response and execute tools dynamically
    const { text: replyText } = await generateText({
      model: openai("gpt-4o-mini", { structuredOutputs: false }),
      system: `You are the user's Power Personal Assistant. Your job is to stay organized and proactive.
You have access to their Digital Brain (database) via tools.
Use tools to create tasks, search the Vault, or update existing items.

RULES:
- **ANTI-CLUTTER**: If a task sounds like a "maybe," a "someday," or a random idea, set isBacklog: true.
- **TIME AWARENESS**: If the user mentions a time or date, set the dueDate.
- **SEARCH BEFORE CREATING**: If the user asks about something, search the Vault first.
- **GITHUB ASSISTANT**: You can search repositories, list issues, and check notifications for the user on GitHub (SilverbackWeb).
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
            dueDate: z.string().optional().describe("ISO date string if mentioned")
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
                    create: { telegramId: chatId.toString(), name: message.chat.first_name || "User" }
                  }
                }
              }
            });
            return { success: true, taskId: task.id, status };
          }
        }),
        searchVault: tool({
          description: "Search the Vault/Backlog for specific keywords or topics.",
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            const results = await prisma.task.findMany({
              where: {
                status: "BACKLOG",
                OR: [
                  { title: { contains: query } },
                  { description: { contains: query } }
                ]
              },
              take: 5
            });
            return results.map(t => ({ id: t.id, title: t.title, category: t.category }));
          }
        }),
        updateTask: tool({
          description: "Update an existing task's priority, due date, or status.",
          parameters: z.object({
            title: z.string().describe("Part of the title to find the task"),
            priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
            dueDate: z.string().optional().describe("ISO date string"),
            status: z.enum(["TODO", "IN_PROGRESS", "DONE", "BACKLOG"]).optional()
          }),
          execute: async ({ title, priority, dueDate, status }) => {
            const task = await prisma.task.findFirst({
              where: { title: { contains: title }, user: { telegramId: chatId.toString() } }
            });
            if (!task) return { success: false, reason: "Task not found" };

            const updated = await prisma.task.update({
              where: { id: task.id },
              data: {
                ...(priority && { priority }),
                ...(dueDate && { dueDate: new Date(dueDate) }),
                ...(status && { status })
              }
            });
            return { success: true, updated: updated.title };
          }
        }),
        getPendingTasks: tool({
          description: "List the user's currently pending tasks (TODO or IN_PROGRESS).",
          parameters: z.object({}),
          execute: async () => {
             const tasks = await prisma.task.findMany({
               where: {
                 status: { in: ["TODO", "IN_PROGRESS", "AGENT_WORKING"] },
                 user: { telegramId: chatId.toString() }
               },
               orderBy: { priority: "asc" }
             });
             return tasks.map(t => ({
               id: t.id,
               title: t.title,
               priority: t.priority,
               status: t.status,
               dueDate: t.dueDate
             }));
          }
        }),
        markTaskDone: tool({
          description: "Mark a task as completed/DONE.",
          parameters: z.object({ title: z.string() }),
          execute: async ({ title }) => {
             const task = await prisma.task.findFirst({
               where: { title: { contains: title }, user: { telegramId: chatId.toString() } }
             });
             if (task) {
               await prisma.task.update({ where: { id: task.id }, data: { status: "DONE" } });
               return { success: true, updated: task.title };
             }
             return { success: false, reason: "Task not found" };
          }
        }),
        listGitHubRepos: tool({
          description: "List all GitHub repositories for the authenticated user.",
          parameters: z.object({}),
          execute: async () => {
            return await listUserRepos();
          }
        }),
        searchGitHubRepos: tool({
          description: "Search for a specific GitHub repository by name or keyword.",
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            return await searchUserRepos(query);
          }
        }),
        getGitHubIssues: tool({
          description: "Fetch open issues for a specific GitHub repository.",
          parameters: z.object({ 
            owner: z.string().describe("Owner of the repo (e.g., 'SilverbackWeb')"),
            repo: z.string().describe("Name of the repo (e.g., 'Alfred')")
          }),
          execute: async ({ owner, repo }) => {
            const issues = await getRepoIssues(owner, repo);
            return issues;
          }
        }),
        getGitHubActivity: tool({
          description: "Check for recent GitHub notifications or mentions.",
          parameters: z.object({}),
          execute: async () => {
            const notifs = await getGitHubNotifications();
            return notifs;
          }
        })
      }
    });

    // Fire the response back to Telegram
    if (TELEGRAM_TOKEN && replyText) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Logic Error:", error);
    return NextResponse.json({ ok: true });
  }
}
