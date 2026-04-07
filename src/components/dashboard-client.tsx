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
  AlertCircle,
  X,
  Tag,
  Layers,
  History
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
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

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
  const completed = initialTasks.filter((t) => t.status === "DONE");

  const vaultTasks = initialTasks.filter(t => t.status === "BACKLOG");
  const personalBacklog = vaultTasks.filter(t => t.category === "PERSONAL");
  const businessBacklog = vaultTasks.filter(t => t.category === "BUSINESS");
  const ideasBacklog = vaultTasks.filter(t => t.category === "IDEA");

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

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-300 ${showCompleted ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-gray-900/40 text-gray-400 border-gray-800 hover:text-gray-200"}`}
          >
            <History className="w-4 h-4" />
            Completed {completed.length > 0 && `(${completed.length})`}
          </button>
          <p className="text-sm font-medium text-gray-400 border border-gray-800 bg-gray-900/40 px-4 py-2 rounded-full">
            {viewMode === "FOCUS" ? `${toDos.length + inProgress.length + agentTasks.length} Active` : `${vaultTasks.length} in Vault`}
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

      {/* Completed overlay */}
      {showCompleted && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-gray-200">Completed</h2>
            <span className="bg-gray-800 text-gray-400 text-xs px-2.5 py-1 rounded-full">{completed.length}</span>
          </div>
          {completed.length === 0 ? (
            <p className="text-gray-500 text-sm px-1">Nothing completed yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {completed.map(task => <TaskCard key={task.id} task={task} onOpen={setSelectedTask} />)}
            </div>
          )}
        </div>
      )}

      {!showCompleted && viewMode === "FOCUS" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Column title="To Do" icon={<Circle className="w-5 h-5 text-gray-400"/>} count={toDos.length}>
            {toDos.map(task => <TaskCard key={task.id} task={task} onOpen={setSelectedTask} />)}
          </Column>

          <Column title="In Progress" icon={<Clock className="w-5 h-5 text-indigo-400"/>} count={inProgress.length}>
            {inProgress.map(task => <TaskCard key={task.id} task={task} onOpen={setSelectedTask} />)}
          </Column>

          <Column title="Agent Tasks" icon={<Bot className="w-5 h-5 text-purple-400"/>} count={agentTasks.length}>
            {agentTasks.map(task => <TaskCard key={task.id} task={task} onOpen={setSelectedTask} />)}
          </Column>
        </div>
      )}

      {!showCompleted && viewMode === "VAULT" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Column title="Personal" icon={<FolderArchive className="w-5 h-5 text-emerald-400"/>} count={personalBacklog.length}>
            {personalBacklog.map(task => <TaskCard key={task.id} task={task} isVault onOpen={setSelectedTask} />)}
          </Column>

          <Column title="Business" icon={<FolderArchive className="w-5 h-5 text-amber-400"/>} count={businessBacklog.length}>
            {businessBacklog.map(task => <TaskCard key={task.id} task={task} isVault onOpen={setSelectedTask} />)}
          </Column>

          <Column title="Ideas" icon={<Sparkles className="w-5 h-5 text-pink-400"/>} count={ideasBacklog.length}>
            {ideasBacklog.map(task => <TaskCard key={task.id} task={task} isVault onOpen={setSelectedTask} />)}
          </Column>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
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

function TaskCard({ task, isVault = false, onOpen }: { task: Task, isVault?: boolean, onOpen: (task: Task) => void }) {
  const isAgent = task.status === "AGENT_WORKING";

  const togglePriority = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const priorities = ["LOW", "MEDIUM", "HIGH"];
    const currentIdx = priorities.indexOf(task.priority);
    const nextPriority = priorities[(currentIdx + 1) % priorities.length];
    await updateTaskAction(task.id, { priority: nextPriority });
  };

  const setDueDate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const date = e.target.value ? new Date(e.target.value) : null;
    await updateTaskAction(task.id, { dueDate: date });
  };

  return (
    <div
      onClick={() => onOpen(task)}
      className={`glass-panel group p-4 rounded-xl transition-all relative hover:-translate-y-1 hover:shadow-xl cursor-pointer ${isAgent ? 'border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] bg-purple-500/5' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-medium text-gray-100 leading-tight pr-8">{task.title}</h3>

        {/* Action Buttons */}
        <div className="absolute top-4 right-4 flex flex-col gap-3 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0">
          {!isVault && task.status === "TODO" && (
            <button
              onClick={(e) => { e.stopPropagation(); moveTaskToStatusAction(task.id, "IN_PROGRESS"); }}
              className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-colors"
              title="Start Task"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
            </button>
          )}
          {!isVault && task.status === "IN_PROGRESS" && (
            <button
              onClick={(e) => { e.stopPropagation(); moveTaskToStatusAction(task.id, "DONE"); }}
              className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
              title="Complete Task"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          )}
          {task.status === "DONE" && (
            <button
              onClick={(e) => { e.stopPropagation(); moveTaskToStatusAction(task.id, "TODO"); }}
              className="p-1.5 bg-gray-500/20 text-gray-400 rounded-lg hover:bg-gray-500/30 transition-colors"
              title="Undo/Re-open"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {isVault && (
            <button
              onClick={(e) => { e.stopPropagation(); moveTaskToStatusAction(task.id, "TODO"); }}
              className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
              title="Escalate to Focus Mode"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); deleteTaskAction(task.id); }}
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

        <div className="relative group/date" onClick={(e) => e.stopPropagation()}>
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

function TaskDetailModal({ task, onClose }: { task: Task, onClose: () => void }) {
  const priorityColors: Record<string, string> = {
    HIGH: 'bg-red-500/10 text-red-400 border border-red-500/20',
    MEDIUM: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    LOW: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  };

  const statusColors: Record<string, string> = {
    TODO: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    IN_PROGRESS: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
    AGENT_WORKING: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    DONE: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    BACKLOG: 'bg-gray-500/10 text-gray-500 border border-gray-700/20',
  };

  const statusLabels: Record<string, string> = {
    TODO: 'To Do',
    IN_PROGRESS: 'In Progress',
    AGENT_WORKING: 'Agent Working',
    DONE: 'Done',
    BACKLOG: 'Vault',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-lg bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold text-white leading-snug">{task.title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Description */}
        <div>
          <p className="text-sm text-gray-500 uppercase font-semibold tracking-wider mb-2">Description</p>
          <p className="text-gray-300 leading-relaxed text-sm">
            {task.description || "No description provided."}
          </p>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3 h-3" /> Status
            </p>
            <span className={`text-xs font-bold px-2.5 py-1 rounded ${statusColors[task.status] || ''}`}>
              {statusLabels[task.status] || task.status}
            </span>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" /> Priority
            </p>
            <span className={`text-xs font-bold px-2.5 py-1 rounded ${priorityColors[task.priority] || ''}`}>
              {task.priority}
            </span>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5">
              <Tag className="w-3 h-3" /> Category
            </p>
            <span className="text-xs font-bold text-gray-300">{task.category}</span>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" /> Due Date
            </p>
            <span className="text-xs font-bold text-gray-300">
              {task.dueDate ? format(new Date(task.dueDate), 'MMM d, yyyy') : 'Not set'}
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-600 border-t border-gray-800 pt-4">
          Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
        </p>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          {task.status === "TODO" && (
            <button
              onClick={() => { moveTaskToStatusAction(task.id, "IN_PROGRESS"); onClose(); }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all"
            >
              <Play className="w-4 h-4 fill-current" /> Start Task
            </button>
          )}
          {task.status === "IN_PROGRESS" && (
            <button
              onClick={() => { moveTaskToStatusAction(task.id, "DONE"); onClose(); }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all"
            >
              <CheckCircle2 className="w-4 h-4" /> Mark Done
            </button>
          )}
          {task.status === "BACKLOG" && (
            <button
              onClick={() => { moveTaskToStatusAction(task.id, "TODO"); onClose(); }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all"
            >
              <ArrowUpCircle className="w-4 h-4" /> Move to Focus
            </button>
          )}
          {task.status === "DONE" && (
            <button
              onClick={() => { moveTaskToStatusAction(task.id, "TODO"); onClose(); }}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all"
            >
              <RotateCcw className="w-4 h-4" /> Re-open
            </button>
          )}
          <button
            onClick={() => { deleteTaskAction(task.id); onClose(); }}
            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-4 py-2 rounded-xl font-bold text-sm transition-all border border-red-500/20 ml-auto"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
