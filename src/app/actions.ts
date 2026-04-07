"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function deleteTaskAction(id: string) {
  await prisma.task.delete({
    where: { id },
  });
  revalidatePath("/");
}

export async function moveTaskToStatusAction(id: string, newStatus: string) {
  await prisma.task.update({
    where: { id },
    data: { status: newStatus }
  });
  revalidatePath("/");
}

export async function updateTaskAction(id: string, data: { title?: string, priority?: string, dueDate?: Date | null }) {
  await prisma.task.update({
    where: { id },
    data
  });
  revalidatePath("/");
}
