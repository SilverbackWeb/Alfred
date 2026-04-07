"use client";

import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { 
  Bot, 
  CheckCircle2, 
  Circle, 
  Clock, 
  Sparkles, 
  Trash2, 
  FolderArchive, 
  Zap, 
  ArrowUpCircle, 
  Play, 
  RotateCcw,
  Calendar,
  AlertCircle
} from "lucide-react";
import { deleteTaskAction, moveTaskToStatusAction, updateTaskAction } from "@/app/actions";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string;
  dueDate: Date | null;
  createdAt: Date;
};

export default function DashboardClient({ initialTasks }: { initialTasks: Task[] }) {
  const [viewMode, setViewMode] = useState<"FOCUS" | "VAULT">("FOCUS");

  const focusTasks = initialTasks
    .filter(t => t.status !== "BACKLOG")
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const toDos = focusTasks.filter((t) => t.status === "TODO");
  const inProgress = focusTasks.filter((t) => t.status === "IN_PROGRESS");
  const agentTasks = focusTasks.filter((t) => t.status === "AGENT_WORKING");
  const done = focusTasks.filter((t) => t.status === "DONE");

  const vaultTasks = initialTasks.filter(t => t.status === "BACKLOG");
  const personalBacklog = vaultTasks.filter(t => t.category === "PERSONAL");
  const businessBacklog = vaultTasks.filter(t => t.category === "BUSINESS");
  const ideasBacklog = vaultTasks.filter(t => t.category === "IDEA");

  // Next Up logic: Highest priority task that isn't DONE
  const nextUp = focusTasks.find(t => t.status !== "DONE");

  return (
    <div className="flex flex-col gap-8">
      
      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-gray-900/50 p-2 rounded-xl border border-gray-800 shadow-xl">
          <button 
            onClick={() => setViewMode("FOCUS")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 ${viewMode === "FOCUS" ? "bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.1)]" : "text-gray-400 hover:text-gray-200"}`}
          >
            <Zap className="w-4 h-4" /> Focus Mode
          </button>
          <button 
            onClick={() => setViewMode("VAULT")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 ${viewMode === "VAULT" ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "text-gray-400 hover:text-gray-200"}`}
          >
            <FolderArchive className="w-4 h-4" /> The Vault
          </button>
        </div>
        
        <div className="text-right">
          <p className="text-sm font-medium text-gray-400 border border-gray-800 bg-gray-900/40 px-4 py-2 rounded-full">
            {viewMode === "FOCUS" ? `${focusTasks.length} Active Tasks` : `${vaultTasks.length} Archived Tasks`}
          </p>
        </div>
      </div>

      {viewMode === "FOCUS" && nextUp && (
        <div className="bg-gradient-to-br from-indigo-600/10 via-purple-600/10 to-transparent p-6 rounded-3xl border border-indigo-500/20 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Sparkles className="w-32 h-32 text-indigo-500 rotate-12" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded">Next Priority</span>
              <AlertCircle className="w-4 h-4 text-indigo-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">{nextUp.title}</h1>
            <p className="text-gray-400 max-w-2xl mb-6">{nextUp.description || "No description provided."}</p>
            <div className="flex items-center gap-4">
               <button 
                onClick={() => moveTaskToStatusAction(nextUp.id, "IN_PROGRESS")}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2"
               >
                 <Play className="w-4 h-4 fill-current" /> Start This Now
               </button>
               {nextUp.dueDate && (
                 <div className="flex items-center gap-2 text-indigo-300 text-sm font-medium">
                   <Calendar className="w-4 h-4" />
                   Due {formatDistanceToNow(new Date(nextUp.dueDate), { addSuffix: true })}
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {viewMode === "FOCUS" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Column title="To Do" icon={<Circle className="w-5 h-5 text-gray-400"/>} count={toDos.length}>
            {toDos.map(task => <TaskCard key={task.id} task={task} />)}
          </Column>

          <Column title="In Progress" icon={<Clock className="w-5 h-5 text-indigo-400"/>} count={inProgress.length}>
            {inProgress.map(task => <TaskCard key={task.id} task={task} />)}
          </Column>

          <Column title="Agent Tasks" icon={<Bot className="w-5 h-5 text-purple-400"/>} count={agentTasks.length}>
            {agentTasks.map(task => <TaskCard key={task.id} task={task} />)}
          </Column>

          <Column title="Done" icon={<CheckCircle2 className="w-5 h-5 text-emerald-400"/>} count={done.length}>
            {done.map(task => <TaskCard key={task.id} task={task} />)}
          </Column>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Column title="Personal Backlog" icon={<FolderArchive className="w-5 h-5 text-emerald-400"/>} count={personalBacklog.length}>
            {personalBacklog.map(task => <TaskCard key={task.id} task={task} isVault />)}
          </Column>

          <Column title="Business Backlog" icon={<FolderArchive className="w-5 h-5 text-amber-400"/>} count={businessBacklog.length}>
            {businessBacklog.map(task => <TaskCard key={task.id} task={task} isVault />)}
          </Column>

          <Column title="Business Ideas" icon={<Sparkles className="w-5 h-5 text-pink-400"/>} count={ideasBacklog.length}>
            {ideasBacklog.map(task => <TaskCard key={task.id} task={task} isVault />)}
          </Column>
        </div>
      )}

    </div>
  );
}

function Column({ title, icon, count, children }: { title: string, icon: React.ReactNode, count: number, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 bg-gray-900/20 p-4 rounded-2xl border border-gray-800/50">
      <div className="flex items-center gap-2 mb-2 px-1">
        {icon}
        <h2 className="font-semibold text-lg text-gray-200">{title}</h2>
        <span className="ml-auto bg-gray-800 text-gray-400 text-xs px-2.5 py-1 rounded-full">{count}</span>
      </div>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}

function TaskCard({ task, isVault = false }: { task: Task, isVault?: boolean }) {
  const isAgent = task.status === "AGENT_WORKING";
  
  const togglePriority = async () => {
    const priorities = ["LOW", "MEDIUM", "HIGH"];
    const currentIdx = priorities.indexOf(task.priority);
    const nextPriority = priorities[(currentIdx + 1) % priorities.length];
    await updateTaskAction(task.id, { priority: nextPriority });
  };

  const setDueDate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    await updateTaskAction(task.id, { dueDate: date });
  };

  return (
    <div className={`glass-panel group p-4 rounded-xl transition-all relative hover:-translate-y-1 hover:shadow-xl ${isAgent ? 'border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] bg-purple-500/5' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-medium text-gray-100 leading-tight pr-8">{task.title}</h3>
        
        {/* Action Buttons */}
        <div className="absolute top-4 right-4 flex flex-col gap-3 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0">
          {!isVault && task.status === "TODO" && (
            <button 
              onClick={() => moveTaskToStatusAction(task.id, "IN_PROGRESS")}
              className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-colors"
              title="Start Task"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
            </button>
          )}
          {!isVault && task.status === "IN_PROGRESS" && (
            <button 
              onClick={() => moveTaskToStatusAction(task.id, "DONE")}
              className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
              title="Complete Task"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          )}
          {task.status === "DONE" && (
            <button 
              onClick={() => moveTaskToStatusAction(task.id, "TODO")}
              className="p-1.5 bg-gray-500/20 text-gray-400 rounded-lg hover:bg-gray-500/30 transition-colors"
              title="Undo/Re-open"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {isVault && (
            <button 
              onClick={() => moveTaskToStatusAction(task.id, "TODO")}
              className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
              title="Escalate to Focus Mode"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            onClick={() => deleteTaskAction(task.id)}
            className="p-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            title="Delete Task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {task.description && (
        <p className="text-sm text-gray-400 line-clamp-2 mb-3 leading-relaxed">{task.description}</p>
      )}

      {/* Interactive Controls */}
      <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-gray-800/50">
        <button 
          onClick={togglePriority}
          className={`text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded transition-colors
            ${task.priority === 'HIGH' ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' : 
              task.priority === 'MEDIUM' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20' : 
              'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20'}`}>
          {task.priority}
        </button>

        <div className="relative group/date">
          <Calendar className="w-3.5 h-3.5 text-gray-500 group-hover/date:text-indigo-400 transition-colors" />
          <input 
            type="date" 
            defaultValue={task.dueDate ? format(new Date(task.dueDate), 'yyyy-MM-dd') : ''}
            onChange={setDueDate}
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
          />
          {task.dueDate && (
            <span className="text-[10px] text-gray-400 ml-1">
              {format(new Date(task.dueDate), 'MMM d')}
            </span>
          )}
        </div>

        <span className="text-[10px] text-gray-600 ml-auto font-medium">
          {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
