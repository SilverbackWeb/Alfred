import { prisma } from "@/lib/prisma";
import DashboardClient from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="min-h-screen max-w-7xl mx-auto p-6 md:p-12 relative z-10">
      <header className="mb-10 mt-4">
        <h1 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
          Digital Brain
        </h1>
        <p className="text-gray-400 mt-2 text-lg">
          Your Personal PA dashboard. Stay organized.
        </p>
      </header>
      
      {/* We pass the serialized records to our client state */}
      <DashboardClient initialTasks={tasks} />
    </main>
  );
}
