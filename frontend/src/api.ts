import type { Category, Task } from "./types";

const API_BASE = "/api";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("focusflow-token");
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export const authStorage = {
  setToken: (token: string) => localStorage.setItem("focusflow-token", token),
  clearToken: () => localStorage.removeItem("focusflow-token"),
  getToken: () => localStorage.getItem("focusflow-token"),
};

export const authApi = {
  register: (payload: { email: string; username: string; password: string }) =>
    api<{ status: string; verification_link?: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: { identifier: string; password: string }) =>
    api<{ token: string; user: { id: number; email: string; username: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(payload) }
    ),
  verify: (token: string) =>
    api<{ status: string }>(`/auth/verify?token=${encodeURIComponent(token)}`),
  resend: (payload: { email: string }) =>
    api<{ status: string; verification_link?: string }>("/auth/resend", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: () => api<{ id: number; email: string; username: string }>("/auth/me"),
  logout: () => api<{ status: string }>("/auth/logout", { method: "POST" }),
  updateProfile: (payload: {
    email: string;
    username: string;
    current_password: string;
  }) =>
    api<{ status: string; user: { id: number; email: string; username: string }; verification_link?: string }>(
      "/auth/profile",
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    api<{ status: string }>("/auth/password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resetRequest: (payload: { email: string }) =>
    api<{ status: string; reset_link?: string }>("/auth/reset-request", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resetConfirm: (payload: { token: string; password: string }) =>
    api<{ status: string }>("/auth/reset", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteAccount: (payload: { current_password: string }) =>
    api<{ status: string }>("/auth/account", {
      method: "DELETE",
      body: JSON.stringify(payload),
    }),
};

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

export const configApi = {
  smtp: {
    get: () =>
      api<{
        host?: string;
        port?: number;
        user?: string;
        from?: string;
      }>("/config/smtp"),
    update: (payload: {
      host: string;
      port?: number;
      user?: string;
      password?: string;
      from: string;
    }) =>
      api<{ status: string }>("/config/smtp", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
  },
};
