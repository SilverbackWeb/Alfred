import Image from "next/image";
import { prisma } from "@/lib/prisma";
import DashboardClient from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="min-h-screen max-w-7xl mx-auto px-4 py-6 md:px-12 md:py-10 relative z-10">

      {/* Header */}
      <header className="mb-10">
        <div className="relative flex flex-col items-center text-center md:flex-row md:text-left gap-6 md:gap-8 p-6 md:p-8 rounded-3xl overflow-hidden border border-indigo-500/20 bg-gradient-to-br from-gray-900/80 via-indigo-950/40 to-gray-900/80 shadow-2xl">

          {/* Background glow */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.15),transparent_60%)] pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(168,85,247,0.1),transparent_60%)] pointer-events-none" />

          {/* Avatar */}
          <div className="relative shrink-0">
            {/* Outer glow ring */}
            <div className="absolute inset-0 rounded-full bg-indigo-500/30 blur-xl scale-110" />
            {/* Spinning circuit ring */}
            <div className="absolute -inset-1 rounded-full border border-indigo-500/40 animate-spin" style={{ animationDuration: "12s" }} />
            <div className="absolute -inset-2 rounded-full border border-purple-500/20 animate-spin" style={{ animationDuration: "20s", animationDirection: "reverse" }} />
            {/* Image */}
            <div className="relative w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-indigo-400/60 shadow-[0_0_30px_rgba(99,102,241,0.4)]">
              <Image
                src="/alfred.png"
                alt="Alfred"
                fill
                className="object-cover object-top"
                priority
              />
            </div>
            {/* Online indicator */}
            <div className="absolute bottom-1 right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-gray-900 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          </div>

          {/* Text */}
          <div className="relative z-10">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full">
                AI Butler • Online
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-200 to-purple-400 leading-none mt-2 mb-3">
              ALFRED
            </h1>
            <p className="text-gray-400 text-base md:text-lg font-medium">
              Personal Assistant Dashboard
            </p>
            <p className="text-gray-600 text-sm mt-1 hidden md:block">
              Good to see you. What are we conquering today?
            </p>
          </div>

          {/* Stats — hidden on smallest screens */}
          <div className="relative z-10 flex gap-4 md:ml-auto md:flex-col md:items-end">
            <div className="text-center md:text-right">
              <p className="text-2xl font-black text-white">{tasks.filter(t => t.status !== "BACKLOG" && t.status !== "DONE").length}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Active</p>
            </div>
            <div className="text-center md:text-right">
              <p className="text-2xl font-black text-emerald-400">{tasks.filter(t => t.status === "DONE").length}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Done</p>
            </div>
            <div className="text-center md:text-right">
              <p className="text-2xl font-black text-indigo-400">{tasks.filter(t => t.status === "BACKLOG").length}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">In Vault</p>
            </div>
          </div>
        </div>
      </header>

      <DashboardClient initialTasks={tasks} />
    </main>
  );
}
