const fs = require('fs');
const path = require('path');
const { PDFExtract } = require('pdf.js-extract');
const { generateObject } = require('ai');
const { openai } = require('@ai-sdk/openai');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const pdfExtract = new PDFExtract();
const inboxDir = path.join(__dirname, 'inbox');
const outboxDir = path.join(__dirname, 'outbox');

if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir);

(async () => {
    try {
        const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.pdf'));
        if (files.length === 0) {
            console.log('No PDFs found in the inbox folder.');
            process.exit(0);
        }

        console.log(`Found ${files.length} PDFs. Beginning import...`);

        for (const file of files) {
            console.log(`\n📄 Processing: ${file}`);
            const filePath = path.join(inboxDir, file);
            
            // Extract text natively
            const data = await pdfExtract.extract(filePath, {});
            const extractedText = data.pages
                .map(page => page.content.map(item => item.str).join(' '))
                .join('\n');
            
            console.log(`Analyzing ${extractedText.length} characters of text with AI...`);
            
            const { object } = await generateObject({
               model: openai('gpt-4o-mini', { structuredOutputs: false }),
               schema: z.object({
                 tasks: z.array(z.object({
                   title: z.string(),
                   description: z.string(),
                   priority: z.string(),
                   category: z.string()
                 }))
               }),
               prompt: `Extract all distinct tasks, ideas, or reminders from this text.
The text is from a PDF named: "${file}"

RULES:
1. For priority, strict exact string: "LOW", "MEDIUM", or "HIGH". If it sounds urgent, HIGH.
2. For category, strict exact string: "PERSONAL", "BUSINESS", or "IDEA". (If it's a household chore, it's PERSONAL. If it's a new income stream, it's IDEA. Etc.)
3. Make the title short and punchy (under 60 chars).
4. Put any extra details, dates, or context into the description. If none, leave empty string.

Text to process:
${extractedText}`
            });

            console.log(`✨ Extracted ${object.tasks.length} items from ${file}. Inserting to database...`);
            
            for (const t of object.tasks) {
               await prisma.task.create({
                 data: {
                   title: t.title,
                   description: t.description || "",
                   priority: ["LOW", "MEDIUM", "HIGH"].includes(t.priority) ? t.priority : "MEDIUM",
                   category: ["PERSONAL", "BUSINESS", "IDEA"].includes(t.category) ? t.category : "PERSONAL",
                   status: 'BACKLOG', // Crucial: Sent directly to The Vault to avoid overwhelming the dashboard
                   user: {
                     connectOrCreate: {
                       where: { telegramId: "admin" },
                       create: { telegramId: "admin", name: "User" }
                     }
                   }
                 }
               });
            }
            console.log(`✅ Successfully imported ${file} direct to The Vault.`);
            
            // Move processed PDF to outbox so we don't accidentally process it again later
            fs.renameSync(filePath, path.join(outboxDir, file));
        }
        
        console.log("\n-----------------------");
        console.log("🎉 All PDF Imports Processed Successfully!");
        process.exit(0);
    } catch (e) {
        console.error("\n❌ Import Failed:", e.message || e);
        process.exit(1);
    }
})();
