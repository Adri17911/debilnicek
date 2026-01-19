import type { Category, Task } from "./types";

const API_BASE = "/api";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export const taskApi = {
  list: () => api<Task[]>("/tasks"),
  create: (payload: Partial<Task> & { title: string }) =>
    api<Task>("/tasks", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: number, payload: Partial<Task>) =>
    api<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (id: number) =>
    api<{ status: string }>(`/tasks/${id}`, { method: "DELETE" }),
};

export const categoryApi = {
  list: () => api<Category[]>("/categories"),
  create: (payload: { name: string }) =>
    api<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
