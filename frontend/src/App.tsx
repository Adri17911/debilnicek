import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { authApi, authStorage, categoryApi, taskApi } from "./api";
import type { Category, Task } from "./types";

const priorities = [
  { value: 1, label: "Low" },
  { value: 2, label: "Medium" },
  { value: 3, label: "High" },
];

const emptyTask = {
  title: "",
  priority: 2,
  estimated_minutes: 15,
};

const formatMinutes = (value?: number | null) => {
  if (!value && value !== 0) return "No estimate";
  return `${value} min`;
};

const suggestBlocks = (value?: number | null) => {
  if (!value) return null;
  if (value <= 25) return "1 × 25";
  if (value <= 45) return "1 × 45";
  if (value <= 60) return "1 × 60";
  if (value <= 90) return "2 × 45";
  const blocks = Math.max(1, Math.round(value / 25));
  return `${blocks} × 25`;
};

const buildCalendarExport = (tasks: Task[]) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  const toIcs = (date: Date) =>
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
      date.getUTCDate()
    )}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;

  const start = new Date(Date.now() + 5 * 60 * 1000);
  let cursor = new Date(start);
  const events = tasks
    .filter((task) => task.estimated_minutes)
    .map((task) => {
      const duration = (task.estimated_minutes ?? 0) * 60 * 1000;
      const eventStart = new Date(cursor);
      const eventEnd = new Date(cursor.getTime() + duration);
      cursor = new Date(eventEnd.getTime() + 5 * 60 * 1000);
      return [
        "BEGIN:VEVENT",
        `UID:${task.id}-${eventStart.getTime()}@focusflow`,
        `DTSTAMP:${toIcs(new Date())}`,
        `DTSTART:${toIcs(eventStart)}`,
        `DTEND:${toIcs(eventEnd)}`,
        `SUMMARY:${task.title}`,
        "END:VEVENT",
      ].join("\n");
    })
    .join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FocusFlow//EN",
    events,
    "END:VCALENDAR",
  ].join("\n");
};

function SortableAgendaItem({
  task,
  formatMinutes,
  suggestBlocks,
  onStart,
  onStop,
  onRemove,
  activeTimerId,
  timerSeconds,
  timerTargetSeconds,
}: {
  task: Task;
  formatMinutes: (v?: number | null) => string;
  suggestBlocks: (v?: number | null) => string | null;
  onStart: () => void;
  onStop: () => void;
  onRemove: () => void;
  activeTimerId: number | null;
  timerSeconds: number;
  timerTargetSeconds: number | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const isThisActive = activeTimerId === task.id;
  const remaining =
    timerTargetSeconds != null && isThisActive
      ? Math.max(0, timerTargetSeconds - timerSeconds)
      : null;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      className={`liquid-glass liquid-sheen rounded-3xl p-4 ${
        isDragging ? "opacity-60 shadow-lg" : ""
      }`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            className="touch-none cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H8v1a1 1 0 11-2V6H4a1 1 0 010-2h3V3a1 1 0 011-1zm10 4h-1v1a1 1 0 11-2V6h-3a1 1 0 110-2h3a1 1 0 011 1v1zM4 12a1 1 0 011 1v3h3a1 1 0 110 2H5v1a1 1 0 11-2v-3a1 1 0 01-1-1zm12 0a1 1 0 01-1 1h-1v1a1 1 0 11-2v-1h-1a1 1 0 110-2h3a1 1 0 011 1z" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-slate-900">{task.title}</p>
            <p className="text-xs text-slate-500">
              {task.category?.name ?? "Uncategorized"} ·{" "}
              {formatMinutes(task.estimated_minutes)}
              {task.actual_minutes ? ` · Actual ${task.actual_minutes}m` : ""}
            </p>
            {task.estimated_minutes ? (
              <p className="mt-1 text-xs text-slate-400">
                {suggestBlocks(task.estimated_minutes)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {isThisActive ? (
            <>
              <span className="text-lg font-semibold tabular-nums text-slate-900">
                {remaining != null
                  ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : `${Math.floor(timerSeconds / 60)}:${String(timerSeconds % 60).padStart(2, "0")}`}
              </span>
              <button
                type="button"
                onClick={onStop}
                className="liquid-accent liquid-sheen rounded-full px-4 py-1 text-xs"
              >
                Stop & log
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onStart}
              className="liquid-accent liquid-sheen rounded-full px-4 py-1 text-xs"
            >
              Start
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="liquid-pill rounded-full px-2 py-1 text-xs text-slate-500 transition hover:text-slate-700"
          >
            Remove
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function DraggableListTask({
  task,
  children,
}: {
  task: Task;
  children: ReactNode;
}) {
  const id = `pool-${task.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useDraggable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : ""}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="touch-none cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to agenda"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H8v1a1 1 0 11-2V6H4a1 1 0 010-2h3V3a1 1 0 011-1zm10 4h-1v1a1 1 0 11-2V6h-3a1 1 0 110-2h3a1 1 0 011 1v1z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function DroppableCategoryPill({ category }: { category: Category }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cat-${category.name}`,
  });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-full px-3 py-1.5 text-xs transition ${
        isOver
          ? "ring-2 ring-indigo-400 bg-indigo-100 text-indigo-800"
          : "border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {category.name}
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(emptyTask);
  const [categorySelection, setCategorySelection] = useState("Work");
  const [newCategory, setNewCategory] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<
    "all" | "open" | "done" | "focus"
  >("focus");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "whiteboard" | "dashboard">(
    "list"
  );
  const [dailyTargetMinutes, setDailyTargetMinutes] = useState(240);
  const [error, setError] = useState<string | null>(null);
  const [activeSwipeId, setActiveSwipeId] = useState<number | null>(null);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<number, number>>({});
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingActualId, setEditingActualId] = useState<number | null>(null);
  const [editingActualValue, setEditingActualValue] = useState("");
  const [activeTimerId, setActiveTimerId] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerTargetSeconds, setTimerTargetSeconds] = useState<number | null>(null);
  const timerStartRef = useRef<number | null>(null);
  const timerAlarmFiredRef = useRef(false);
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  const [activeDragId, setActiveDragId] = useState<string | number | null>(null);
  const [authUser, setAuthUser] = useState<{
    id: number;
    email: string;
    username: string;
  } | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authStep, setAuthStep] = useState<"auth" | "forgot" | "reset">("auth");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLink, setAuthLink] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notifications, setNotifications] = useState<
    { id: number; message: string; tone: "info" | "success" | "error" | "alarm" }[]
  >([]);
  const notificationIdRef = useRef(0);
  const [authForm, setAuthForm] = useState({
    email: "",
    username: "",
    identifier: "",
    password: "",
  });
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetPasswordForm, setResetPasswordForm] = useState({
    password: "",
    confirm: "",
  });
  const [profileForm, setProfileForm] = useState({
    email: "",
    username: "",
    currentPassword: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [deleteForm, setDeleteForm] = useState({
    currentPassword: "",
    confirm: "",
  });

  const swipeThreshold = 80;
  const maxSwipe = 140;

  const formatError = (caught: unknown, fallback: string) => {
    if (caught instanceof Error && caught.message) {
      return caught.message;
    }
    return fallback;
  };

  const focusTasks = useMemo(
    () => tasks.filter((task) => task.is_focus),
    [tasks]
  );

  const focusOpenTasks = useMemo(
    () => focusTasks.filter((task) => task.status !== "done"),
    [focusTasks]
  );

  const focusEstimatedTotal = useMemo(
    () =>
      focusOpenTasks.reduce(
        (total, task) => total + (task.estimated_minutes ?? 0),
        0
      ),
    [focusOpenTasks]
  );

  const focusDoneMinutes = useMemo(
    () =>
      focusTasks.reduce((total, task) => {
        if (task.status !== "done") return total;
        return total + (task.actual_minutes ?? task.estimated_minutes ?? 0);
      }, 0),
    [focusTasks]
  );

  const focusSuggestion = useMemo(() => {
    const remaining = Math.max(dailyTargetMinutes - focusDoneMinutes, 0);
    const open = focusOpenTasks.slice();
    if (!open.length) return null;
    const sorted = open.sort(
      (a, b) => (a.estimated_minutes ?? 999) - (b.estimated_minutes ?? 999)
    );
    return (
      sorted.find((task) => (task.estimated_minutes ?? 0) <= remaining) ??
      sorted[0]
    );
  }, [dailyTargetMinutes, focusDoneMinutes, focusOpenTasks]);

  const agendaTasks = useMemo(() => {
    return tasks
      .filter((t) => t.is_focus)
      .sort(
        (a, b) =>
          (a.focus_rank ?? 99999) - (b.focus_rank ?? 99999) || a.id - b.id
      );
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    let filtered = tasks;
    if (filterStatus === "open") {
      filtered = filtered.filter((task) => task.status !== "done");
    }
    if (filterStatus === "done") {
      filtered = filtered.filter((task) => task.status === "done");
    }
    if (filterStatus === "focus") {
      filtered = filtered.filter((task) => task.is_focus);
    }
    if (searchTerm.trim()) {
      const normalized = searchTerm.trim().toLowerCase();
      filtered = filtered.filter((task) =>
        task.title.toLowerCase().includes(normalized)
      );
    }
    return filtered;
  }, [tasks, filterStatus, searchTerm]);

  const groupedTasks = useMemo(() => {
    const buckets: Record<string, Task[]> = {
      quick: [],
      medium: [],
      deep: [],
      unestimated: [],
    };
    visibleTasks.forEach((task) => {
      const estimate = task.estimated_minutes ?? 0;
      if (!estimate) {
        buckets.unestimated.push(task);
      } else if (estimate <= 15) {
        buckets.quick.push(task);
      } else if (estimate <= 45) {
        buckets.medium.push(task);
      } else {
        buckets.deep.push(task);
      }
    });
    return [
      { id: "quick", label: "Quick wins (≤15m)", tasks: buckets.quick },
      { id: "medium", label: "Steady wins (≤45m)", tasks: buckets.medium },
      { id: "deep", label: "Deep work (45m+)", tasks: buckets.deep },
      { id: "unestimated", label: "Unestimated", tasks: buckets.unestimated },
    ].filter((group) => group.tasks.length);
  }, [visibleTasks]);

  useEffect(() => {
    const token = authStorage.getToken();
    if (!token) return;
    authApi
      .me()
      .then((user) => setAuthUser(user))
      .catch(() => authStorage.clearToken());
  }, []);

  useEffect(() => {
    if (!authUser) return;
    loadData();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    setProfileForm({
      email: authUser.email,
      username: authUser.username,
      currentPassword: "",
    });
  }, [authUser]);

  useEffect(() => {
    const stored = localStorage.getItem("focusflow-notifications");
    if (stored === "enabled") {
      setNotificationsEnabled(true);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("focusflow-defaults");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as {
        priority?: number;
        estimated_minutes?: number;
        categorySelection?: string;
        viewMode?: "list" | "whiteboard" | "dashboard";
        filterStatus?: "all" | "open" | "done" | "focus";
        dailyTargetMinutes?: number;
      };
      if (parsed.priority) {
        setForm((prev) => ({ ...prev, priority: parsed.priority }));
      }
      if (parsed.estimated_minutes) {
        setForm((prev) => ({ ...prev, estimated_minutes: parsed.estimated_minutes }));
      }
      if (parsed.categorySelection) {
        setCategorySelection(parsed.categorySelection);
      }
      if (parsed.viewMode) {
        setViewMode(parsed.viewMode);
      }
      if (parsed.filterStatus) {
        setFilterStatus(parsed.filterStatus);
      }
      if (parsed.dailyTargetMinutes) {
        setDailyTargetMinutes(parsed.dailyTargetMinutes);
      }
    } catch {
      // Ignore invalid stored data
    }
  }, []);

  useEffect(() => {
    const payload = {
      priority: form.priority,
      estimated_minutes: form.estimated_minutes,
      categorySelection,
      viewMode,
      filterStatus,
      dailyTargetMinutes,
    };
    localStorage.setItem("focusflow-defaults", JSON.stringify(payload));
  }, [
    form.priority,
    form.estimated_minutes,
    categorySelection,
    viewMode,
    filterStatus,
    dailyTargetMinutes,
  ]);

  const pushNotification = (
    message: string,
    tone: "info" | "success" | "error" | "alarm" = "info"
  ) => {
    const id = notificationIdRef.current + 1;
    notificationIdRef.current = id;
    setNotifications((prev) => [...prev, { id, message, tone }]);
    const dismissMs = tone === "alarm" ? 8000 : 3500;
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
    }, dismissMs);
  };

  const sendBrowserNotification = (title: string, body: string) => {
    if (!notificationsEnabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    new Notification(title, { body });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verify");
    if (!token) return;
    authApi
      .verify(token)
      .then(() => {
        setAuthMessage("Email verified. You can now log in.");
        params.delete("verify");
        window.history.replaceState({}, "", `${window.location.pathname}`);
      })
      .catch(() => setAuthMessage("Verification failed. Try resending the email."));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    if (!token) return;
    setResetToken(token);
    setAuthStep("reset");
    params.delete("reset");
    window.history.replaceState({}, "", `${window.location.pathname}`);
  }, []);

  useEffect(() => {
    if (!activeTimerId) return;
    const start = timerStartRef.current ?? Date.now();
    timerStartRef.current = start;
    const interval = window.setInterval(() => {
      setTimerSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeTimerId]);

  useEffect(() => {
    if (
      !activeTimerId ||
      timerTargetSeconds == null ||
      timerAlarmFiredRef.current
    )
      return;
    if (timerSeconds >= timerTargetSeconds) {
      timerAlarmFiredRef.current = true;
      const task = tasks.find((t) => t.id === activeTimerId);
      const title = task ? `Time's up: ${task.title}` : "Time's up!";
      pushNotification(title, "alarm");
      sendBrowserNotification("FocusFlow", title);
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 800;
          osc.type = "sine";
          gain.gain.value = 0.25;
          osc.start(0);
          osc.stop(ctx.currentTime + 0.4);
        }
      } catch {}
      setActiveTimerId(null);
      setTimerTargetSeconds(null);
      timerStartRef.current = null;
      setTimerSeconds(0);
    }
  }, [activeTimerId, timerSeconds, timerTargetSeconds, tasks]);

  const loadData = async () => {
    try {
      const [taskData, categoryData] = await Promise.all([
        taskApi.list(),
        categoryApi.list(),
      ]);
      setTasks(taskData);
      setCategories(categoryData);
      if (categoryData.length) {
        setCategorySelection(categoryData[0].name);
      }
      setError(null);
    } catch (caught) {
      setError(formatError(caught, "Failed to load tasks."));
    }
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    const payload: Partial<Task> & { title: string } = {
      title: form.title.trim(),
      priority: form.priority as 1 | 2 | 3,
      estimated_minutes: form.estimated_minutes,
    };

    if (categorySelection === "__new__" && newCategory.trim()) {
      payload.category_name = newCategory.trim();
    } else if (categorySelection) {
      payload.category_name = categorySelection;
    }

    try {
      const created = await taskApi.create(payload);
      setTasks((prev) => [created, ...prev]);
      setForm(emptyTask);
      setNewCategory("");
      setError(null);
      pushNotification("Task added.", "success");
    } catch (caught) {
      setError(formatError(caught, "Failed to create task."));
      pushNotification("Failed to add task.", "error");
    }
  };

  const handleRegister = async () => {
    setAuthMessage(null);
    setAuthLink(null);
    try {
      const response = await authApi.register({
        email: authForm.email,
        username: authForm.username,
        password: authForm.password,
      });
      setAuthMessage("Check your email to verify your account.");
      setAuthLink(response.verification_link ?? null);
      setAuthMode("login");
      pushNotification("Account created. Verify your email.", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Registration failed."));
      pushNotification("Registration failed.", "error");
    }
  };

  const handleLogin = async () => {
    setAuthMessage(null);
    setAuthLink(null);
    try {
      const response = await authApi.login({
        identifier: authForm.identifier,
        password: authForm.password,
      });
      authStorage.setToken(response.token);
      setAuthUser(response.user);
      pushNotification("Signed in.", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Login failed."));
      pushNotification("Login failed.", "error");
    }
  };

  const handleResetRequest = async () => {
    setAuthMessage(null);
    setAuthLink(null);
    try {
      await authApi.resetRequest({ email: authForm.email });
      setAuthMessage("If that email exists, a reset link was sent.");
      pushNotification("Reset link sent (if account exists).", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Failed to send reset link."));
      pushNotification("Failed to send reset link.", "error");
    }
  };

  const handleResetConfirm = async () => {
    if (!resetToken) {
      setAuthMessage("Reset link is missing or invalid.");
      return;
    }
    if (resetPasswordForm.password.length < 8) {
      setAuthMessage("Password must be at least 8 characters.");
      return;
    }
    if (resetPasswordForm.password !== resetPasswordForm.confirm) {
      setAuthMessage("Passwords do not match.");
      return;
    }
    setAuthMessage(null);
    try {
      await authApi.resetConfirm({
        token: resetToken,
        password: resetPasswordForm.password,
      });
      setResetToken(null);
      setResetPasswordForm({ password: "", confirm: "" });
      setAuthStep("auth");
      setAuthMode("login");
      setAuthMessage("Password updated. You can now log in.");
      pushNotification("Password reset. Please sign in.", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Password reset failed."));
      pushNotification("Password reset failed.", "error");
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore logout errors
    }
    authStorage.clearToken();
    setAuthUser(null);
    setTasks([]);
    setCategories([]);
    pushNotification("Signed out.", "info");
  };

  const handleResend = async () => {
    setAuthMessage(null);
    setAuthLink(null);
    try {
      const response = await authApi.resend({ email: authForm.email });
      setAuthMessage("Verification email sent.");
      setAuthLink(response.verification_link ?? null);
      pushNotification("Verification email sent.", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Failed to resend verification."));
      pushNotification("Resend failed.", "error");
    }
  };

  const handleEnableNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      pushNotification("Browser notifications are not supported.", "error");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationsEnabled(true);
      localStorage.setItem("focusflow-notifications", "enabled");
      pushNotification("Notifications enabled.", "success");
    } else {
      setNotificationsEnabled(false);
      localStorage.setItem("focusflow-notifications", "disabled");
      pushNotification("Notifications disabled.", "info");
    }
  };

  const handleProfileUpdate = async () => {
    setAuthMessage(null);
    setAuthLink(null);
    try {
      const response = await authApi.updateProfile({
        email: profileForm.email,
        username: profileForm.username,
        current_password: profileForm.currentPassword,
      });
      setAuthUser(response.user);
      setAuthMessage("Profile updated.");
      setAuthLink(response.verification_link ?? null);
      setProfileForm((prev) => ({ ...prev, currentPassword: "" }));
      pushNotification("Profile updated.", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Profile update failed."));
      pushNotification("Profile update failed.", "error");
    }
  };

  const handlePasswordUpdate = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setAuthMessage("Passwords do not match.");
      return;
    }
    setAuthMessage(null);
    try {
      await authApi.changePassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      });
      setAuthMessage("Password updated.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      pushNotification("Password updated.", "success");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Password update failed."));
      pushNotification("Password update failed.", "error");
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteForm.confirm !== authUser?.username) {
      setAuthMessage("Type your username to confirm.");
      return;
    }
    try {
      await authApi.deleteAccount({ current_password: deleteForm.currentPassword });
      authStorage.clearToken();
      setAuthUser(null);
      pushNotification("Account deleted.", "info");
    } catch (caught) {
      setAuthMessage(formatError(caught, "Account deletion failed."));
      pushNotification("Account deletion failed.", "error");
    }
  };

  const handleCreateCategory = async () => {
    if (!categoryNameDraft.trim()) return;
    try {
      const created = await categoryApi.create({ name: categoryNameDraft.trim() });
      setCategories((prev) => {
        if (prev.find((item) => item.id === created.id)) {
          return prev;
        }
        return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setCategorySelection(created.name);
      setCategoryNameDraft("");
      setDetailsOpen(true);
      setError(null);
      pushNotification("Category added.", "success");
    } catch (caught) {
      setError(formatError(caught, "Failed to create category."));
      pushNotification("Failed to add category.", "error");
    }
  };

  const toggleDone = async (task: Task) => {
    try {
      const updated = await taskApi.update(task.id, {
        status: task.status === "done" ? "open" : "done",
      });
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updated : item))
      );
      setError(null);
      pushNotification(
        updated.status === "done" ? "Marked done." : "Reopened task.",
        "success"
      );
    } catch (caught) {
      setError(formatError(caught, "Failed to update task."));
      pushNotification("Failed to update task.", "error");
    }
  };

  const toggleFocus = async (task: Task) => {
    try {
      const updated = await taskApi.update(task.id, { is_focus: !task.is_focus });
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updated : item))
      );
      setError(null);
      pushNotification(
        updated.is_focus ? "Added to today's agenda." : "Removed from agenda.",
        "success"
      );
    } catch (caught) {
      setError(formatError(caught, "Failed to update agenda."));
      pushNotification("Failed to update agenda.", "error");
    }
  };

  const startEditing = (task: Task) => {
    setEditingId(task.id);
    setEditingTitle(task.title);
  };

  const commitEdit = async (task: Task) => {
    const trimmed = editingTitle.trim();
    setEditingId(null);
    if (!trimmed || trimmed === task.title) return;
    try {
      const updated = await taskApi.update(task.id, { title: trimmed });
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updated : item))
      );
      setError(null);
      pushNotification("Task renamed.", "success");
    } catch (caught) {
      setError(formatError(caught, "Failed to rename task."));
      pushNotification("Failed to rename task.", "error");
    }
  };

  const startActualEdit = (task: Task) => {
    setEditingActualId(task.id);
    setEditingActualValue(task.actual_minutes?.toString() ?? "");
  };

  const commitActualEdit = async (task: Task) => {
    const trimmed = editingActualValue.trim();
    setEditingActualId(null);
    if (!trimmed) {
      if (!task.actual_minutes) return;
    }
    const parsed = trimmed ? Number(trimmed) : null;
    if (trimmed && Number.isNaN(parsed)) return;
    try {
      const updated = await taskApi.update(task.id, {
        actual_minutes: parsed,
      });
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updated : item))
      );
      setError(null);
      pushNotification("Actual time saved.", "success");
    } catch (caught) {
      setError(formatError(caught, "Failed to update actual time."));
      pushNotification("Failed to save actual time.", "error");
    }
  };

  const startTimer = (task: Task) => {
    timerStartRef.current = Date.now();
    setTimerSeconds(0);
    timerAlarmFiredRef.current = false;
    const mins = task.estimated_minutes ?? 25;
    setTimerTargetSeconds(mins * 60);
    setActiveTimerId(task.id);
  };

  const stopTimer = async () => {
    const task = tasks.find((item) => item.id === activeTimerId);
    const elapsedMinutes = Math.max(1, Math.round(timerSeconds / 60));
    setActiveTimerId(null);
    setTimerTargetSeconds(null);
    timerStartRef.current = null;
    setTimerSeconds(0);
    if (!task) return;
    try {
      const updated = await taskApi.update(task.id, {
        actual_minutes: (task.actual_minutes ?? 0) + elapsedMinutes,
      });
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updated : item))
      );
      setError(null);
      pushNotification(`Logged ${elapsedMinutes} min.`, "success");
      sendBrowserNotification("FocusFlow", `Logged ${elapsedMinutes} minutes.`);
    } catch (caught) {
      setError(formatError(caught, "Failed to log focus time."));
      pushNotification("Failed to log focus time.", "error");
    }
  };

  const handleExportCalendar = () => {
    if (!focusOpenTasks.length) return;
    const ics = buildCalendarExport(focusOpenTasks);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "focusflow-plan.ics";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSwipeStart = (taskId: number, event: PointerEvent<HTMLDivElement>) => {
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
    setActiveSwipeId(taskId);
    setSwipeOffsets((prev) => ({ ...prev, [taskId]: 0 }));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSwipeMove = (taskId: number, event: PointerEvent<HTMLDivElement>) => {
    if (activeSwipeId !== taskId || !swipeStartRef.current) return;
    const deltaX = event.clientX - swipeStartRef.current.x;
    const deltaY = event.clientY - swipeStartRef.current.y;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    const clamped = Math.max(-maxSwipe, Math.min(deltaX, maxSwipe));
    setSwipeOffsets((prev) => ({ ...prev, [taskId]: clamped }));
  };

  const finishSwipe = async (task: Task) => {
    const offset = swipeOffsets[task.id] ?? 0;
    swipeStartRef.current = null;
    setActiveSwipeId(null);
    setSwipeOffsets((prev) => ({ ...prev, [task.id]: 0 }));
    if (offset >= swipeThreshold && task.status !== "done") {
      await toggleDone(task);
      return;
    }
    if (offset <= -swipeThreshold) {
      await toggleFocus(task);
    }
  };

  const handleSwipeEnd = (task: Task, event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    void finishSwipe(task);
  };

  const addToAgendaAt = useCallback(
    async (task: Task, index: number) => {
      try {
        const newOrder = [
          ...agendaTasks.slice(0, index),
          task,
          ...agendaTasks.slice(index),
        ];
        await Promise.all(
          newOrder.map((t, i) =>
            taskApi.update(t.id, {
              is_focus: true,
              focus_rank: i,
            })
          )
        );
        await loadData();
        pushNotification("Added to today's agenda.", "success");
      } catch {
        pushNotification("Failed to add to agenda.", "error");
      }
    },
    [agendaTasks, loadData]
  );

  const reorderAgenda = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const reordered = arrayMove(agendaTasks, fromIndex, toIndex);
      try {
        await Promise.all(
          reordered.map((t, i) =>
            taskApi.update(t.id, { focus_rank: i })
          )
        );
        await loadData();
        pushNotification("Agenda reordered.", "success");
      } catch {
        pushNotification("Failed to reorder agenda.", "error");
      }
    },
    [agendaTasks, loadData]
  );

  const assignTaskToCategory = useCallback(
    async (taskId: number, categoryName: string) => {
      try {
        const updated = await taskApi.update(taskId, {
          category_name: categoryName.trim(),
        });
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? updated : t))
        );
        pushNotification(`Assigned to ${categoryName}.`, "success");
      } catch {
        pushNotification("Failed to assign category.", "error");
      }
    },
    []
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragId(null);
      if (!over) return;
      const dragId = active.id;
      const overId = over.id;
      const overIdStr = String(overId);

      if (overIdStr.startsWith("cat-")) {
        const categoryName = overIdStr.slice(4);
        const taskId =
          typeof dragId === "string" && String(dragId).startsWith("pool-")
            ? Number(String(dragId).slice(5))
            : typeof dragId === "number"
            ? dragId
            : null;
        if (taskId != null && tasks.some((t) => t.id === taskId)) {
          await assignTaskToCategory(taskId, categoryName);
        }
        return;
      }

      if (typeof dragId === "string" && String(dragId).startsWith("pool-")) {
        const taskId = Number(String(dragId).slice(5));
        const task = tasks.find((t) => t.id === taskId);
        if (!task || task.is_focus) return;
        const insertIndex =
          overId === "agenda-drop"
            ? agendaTasks.length
            : agendaTasks.findIndex((t) => t.id === overId);
        if (insertIndex === -1 && overId !== "agenda-drop") return;
        await addToAgendaAt(task, overId === "agenda-drop" ? agendaTasks.length : Math.max(0, insertIndex));
        return;
      }
      if (typeof dragId === "number" && agendaTasks.some((t) => t.id === dragId)) {
        const fromIndex = agendaTasks.findIndex((t) => t.id === dragId);
        const toIndex =
          overId === "agenda-drop"
            ? agendaTasks.length - 1
            : agendaTasks.findIndex((t) => t.id === overId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
        await reorderAgenda(fromIndex, toIndex);
      }
    },
    [agendaTasks, tasks, addToAgendaAt, reorderAgenda, assignTaskToCategory]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const { setNodeRef: setAgendaDropRef, isOver: isAgendaOver } = useDroppable({
    id: "agenda-drop",
  });

  if (!authUser) {
    return (
      <div className="min-h-screen bg-transparent text-slate-900">
        <div className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10 sm:px-6 sm:py-12">
          <motion.section
            className="glass-panel liquid-glass liquid-sheen w-full rounded-3xl p-8"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <h1 className="text-3xl font-semibold tracking-tight">FocusFlow</h1>
            <p className="mt-2 text-slate-500">
              {authStep === "reset"
                ? "Set a new password for your account."
                : authStep === "forgot"
                ? "Enter your email and we'll send you a reset link."
                : authMode === "login"
                ? "Welcome back. Sign in to continue."
                : "Create your account to get started."}
            </p>

            {authStep === "auth" ? (
              <div className="mt-6 flex rounded-full border border-slate-200 bg-white/70 p-1 text-xs shadow-sm">
                <button
                  onClick={() => setAuthMode("login")}
                  className={`rounded-full px-3 py-1 transition ${
                    authMode === "login"
                      ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Login
                </button>
                <button
                  onClick={() => setAuthMode("register")}
                  className={`rounded-full px-3 py-1 transition ${
                    authMode === "register"
                      ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Register
                </button>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4">
              {authStep === "forgot" ? (
                <>
                  <input
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Email"
                    value={authForm.email}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                  />
                  <button
                    onClick={handleResetRequest}
                    className="liquid-accent liquid-sheen rounded-2xl px-5 py-3 text-base font-semibold transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    Send reset link
                  </button>
                  <button
                    onClick={() => {
                      setAuthStep("auth");
                      setAuthMode("login");
                    }}
                    className="text-xs text-slate-500 transition hover:text-slate-700"
                  >
                    Back to login
                  </button>
                </>
              ) : authStep === "reset" ? (
                <>
                  <input
                    type="password"
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="New password"
                    value={resetPasswordForm.password}
                    onChange={(event) =>
                      setResetPasswordForm((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                  />
                  <input
                    type="password"
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Confirm password"
                    value={resetPasswordForm.confirm}
                    onChange={(event) =>
                      setResetPasswordForm((prev) => ({
                        ...prev,
                        confirm: event.target.value,
                      }))
                    }
                  />
                  <button
                    onClick={handleResetConfirm}
                    className="liquid-accent liquid-sheen rounded-2xl px-5 py-3 text-base font-semibold transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    Set new password
                  </button>
                  <button
                    onClick={() => {
                      setAuthStep("auth");
                      setAuthMode("login");
                    }}
                    className="text-xs text-slate-500 transition hover:text-slate-700"
                  >
                    Back to login
                  </button>
                </>
              ) : authMode === "register" ? (
                <>
                  <input
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Email"
                    value={authForm.email}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                  />
                  <input
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Username"
                    value={authForm.username}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, username: event.target.value }))
                    }
                  />
                  <input
                    type="password"
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Password"
                    value={authForm.password}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                  />
                  <button
                    onClick={handleRegister}
                    className="liquid-accent liquid-sheen rounded-2xl px-5 py-3 text-base font-semibold transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    Create account
                  </button>
                </>
              ) : (
                <>
                  <input
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Email or username"
                    value={authForm.identifier}
                    onChange={(event) =>
                      setAuthForm((prev) => ({
                        ...prev,
                        identifier: event.target.value,
                      }))
                    }
                  />
                  <input
                    type="password"
                    className="liquid-input rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                    placeholder="Password"
                    value={authForm.password}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                  />
                  <button
                    onClick={handleLogin}
                    className="liquid-accent liquid-sheen rounded-2xl px-5 py-3 text-base font-semibold transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    Sign in
                  </button>
                  <button
                    onClick={() => {
                      setAuthStep("forgot");
                      setAuthMode("login");
                    }}
                    className="text-xs text-slate-500 transition hover:text-slate-700"
                  >
                    Forgot password?
                  </button>
                </>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <button
                onClick={handleResend}
                className="text-slate-600 transition hover:text-slate-800"
              >
                Resend verification
              </button>
              {authMessage ? <span>{authMessage}</span> : null}
            </div>

            {authLink ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
                Dev link: <a href={authLink}>{authLink}</a>
              </div>
            ) : null}
          </motion.section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <motion.div
        className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <motion.header
          className="flex flex-col gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">
            FocusFlow
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
            Calm clarity for your day
          </h1>
          <p className="text-slate-500">
            Capture fast, decide priority, and keep your top three in focus.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>Signed in as {authUser.username}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAccount((prev) => !prev)}
                className="text-slate-600 transition hover:text-slate-800"
              >
                Account
              </button>
              <button
                onClick={handleLogout}
                className="text-slate-600 transition hover:text-slate-800"
              >
                Log out
              </button>
            </div>
          </div>
        </motion.header>

        {showAccount ? (
          <motion.section
            className="glass-panel liquid-glass liquid-sheen soft-fade mt-6 grid gap-6 rounded-3xl p-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <div>
              <h2 className="text-lg font-semibold">Account settings</h2>
              <p className="text-sm text-slate-500">
                Manage your profile, password, and verification.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="Email"
                value={profileForm.email}
                onChange={(event) =>
                  setProfileForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
              <input
                className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="Username"
                value={profileForm.username}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    username: event.target.value,
                  }))
                }
              />
              <input
                type="password"
                className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="Current password"
                value={profileForm.currentPassword}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    currentPassword: event.target.value,
                  }))
                }
              />
              <button
                onClick={handleProfileUpdate}
                className="liquid-accent liquid-sheen rounded-2xl px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                Update profile
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="password"
                className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="Current password"
                value={passwordForm.currentPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    currentPassword: event.target.value,
                  }))
                }
              />
              <input
                type="password"
                className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="New password"
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    newPassword: event.target.value,
                  }))
                }
              />
              <input
                type="password"
                className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="Confirm new password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    confirmPassword: event.target.value,
                  }))
                }
              />
              <button
                onClick={handlePasswordUpdate}
                className="liquid-pill rounded-2xl px-5 py-3 text-sm text-slate-600 transition hover:text-slate-700 md:col-span-3"
              >
                Change password
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <button
                onClick={handleResend}
                className="text-slate-600 transition hover:text-slate-800"
              >
                Resend verification email
              </button>
              <button
                onClick={handleEnableNotifications}
                className="text-slate-600 transition hover:text-slate-800"
              >
                {notificationsEnabled ? "Notifications on" : "Enable notifications"}
              </button>
              {authMessage ? <span>{authMessage}</span> : null}
            </div>

            {authLink ? (
              <div className="rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
                Dev link: <a href={authLink}>{authLink}</a>
              </div>
            ) : null}

            <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
              <p className="text-sm font-semibold text-rose-600">Delete account</p>
              <p className="text-xs text-rose-500">
                This removes your tasks and categories. Type your username to confirm.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input
                  className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-rose-200/60"
                  placeholder="Current password"
                  type="password"
                  value={deleteForm.currentPassword}
                  onChange={(event) =>
                    setDeleteForm((prev) => ({
                      ...prev,
                      currentPassword: event.target.value,
                    }))
                  }
                />
                <input
                  className="liquid-input rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-rose-200/60"
                  placeholder={`Type ${authUser.username}`}
                  value={deleteForm.confirm}
                  onChange={(event) =>
                    setDeleteForm((prev) => ({ ...prev, confirm: event.target.value }))
                  }
                />
              </div>
              <button
                onClick={handleDeleteAccount}
                className="mt-3 rounded-2xl border border-rose-200 bg-rose-100 px-5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-200"
              >
                Delete account
              </button>
            </div>
          </motion.section>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-300/60 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <motion.section
          className="glass-panel liquid-glass liquid-sheen soft-fade mt-8 grid gap-4 rounded-3xl p-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-500">Quick capture</label>
            <input
              className="liquid-input rounded-2xl px-4 py-3 text-lg focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
              placeholder="What do you want to remember?"
              value={form.title}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
            <button
              onClick={() => setDetailsOpen((prev) => !prev)}
              className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-slate-600 shadow-sm transition hover:border-slate-300"
            >
              {detailsOpen ? "Hide details" : "Details"}
            </button>
            <span>Tap a title to edit</span>
          </div>

          {detailsOpen ? (
            <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <span className="text-sm text-slate-500">Priority</span>
              <div className="flex gap-2">
                {priorities.map((priority) => (
                  <button
                    key={priority.value}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        priority: priority.value,
                      }))
                    }
                    className={`flex-1 rounded-2xl px-3 py-2 text-sm transition ${
                      form.priority === priority.value
                        ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                        : "liquid-pill text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {priority.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-slate-500">Category</span>
              <select
                className="liquid-input rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                value={categorySelection}
                onChange={(event) => setCategorySelection(event.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
                <option value="__new__">New category…</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-slate-500">Estimate (minutes)</span>
              <input
                type="number"
                className="liquid-input rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                value={form.estimated_minutes ?? ""}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    estimated_minutes: Number(event.target.value),
                  }))
                }
              />
            </div>
          </div>
          ) : null}

          {detailsOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="liquid-input rounded-full px-3 py-2 text-xs text-slate-600 focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="New category"
                value={categoryNameDraft}
                onChange={(event) => setCategoryNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleCreateCategory();
                  }
                }}
              />
              <button
                onClick={handleCreateCategory}
                className="liquid-pill rounded-full px-3 py-2 text-xs text-slate-600 transition hover:text-slate-700"
              >
                Add category
              </button>
            </div>
          ) : null}

          {detailsOpen && categorySelection === "__new__" ? (
            <input
              className="liquid-input rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
              placeholder="Name your new category"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
          ) : null}

          <button
            onClick={handleCreate}
            className="liquid-accent liquid-sheen rounded-2xl px-5 py-3 text-base font-semibold transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            Add task
          </button>
        </motion.section>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
        <section className="mt-8 grid gap-4">
          <motion.div
            className="liquid-glass liquid-sheen rounded-3xl p-6"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Today’s time plan</h2>
                <p className="text-sm text-slate-500">
                  {focusEstimatedTotal} min reserved · {dailyTargetMinutes} min target
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Daily target</span>
                <input
                  type="number"
                  className="liquid-input rounded-full px-3 py-1 text-xs text-slate-600 focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                  value={dailyTargetMinutes}
                  onChange={(event) =>
                    setDailyTargetMinutes(Number(event.target.value) || 0)
                  }
                />
              </div>
            </div>
            <div className="mt-4 h-2 w-full rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-slate-900 transition"
                style={{
                  width: `${Math.min(
                    (focusEstimatedTotal / Math.max(dailyTargetMinutes, 1)) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
          </motion.div>

          <motion.div
            className={`liquid-glass liquid-sheen rounded-3xl p-6 ${isAgendaOver ? "ring-2 ring-indigo-400" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.1 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Today&apos;s agenda</h2>
                <p className="text-sm text-slate-500">
                  Drag tasks here or from the list below. Reorder with the handle. Click Start to run a timer—when time&apos;s up you&apos;ll get an alarm.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportCalendar}
                className="liquid-pill rounded-full px-3 py-1 text-xs text-slate-600 transition hover:text-slate-700"
              >
                Export agenda
              </button>
            </div>
            <div
              ref={setAgendaDropRef}
              className="mt-4 grid min-h-[120px] gap-3"
            >
              <SortableContext
                items={agendaTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {agendaTasks.map((task) => (
                  <SortableAgendaItem
                    key={task.id}
                    task={task}
                    formatMinutes={formatMinutes}
                    suggestBlocks={suggestBlocks}
                    onStart={() => startTimer(task)}
                    onStop={stopTimer}
                    onRemove={() => toggleFocus(task)}
                    activeTimerId={activeTimerId}
                    timerSeconds={timerSeconds}
                    timerTargetSeconds={timerTargetSeconds}
                  />
                ))}
              </SortableContext>
              {!agendaTasks.length ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500">
                  Drag tasks here from All tasks, or add via the Focus button on a task.
                </div>
              ) : null}
            </div>
          </motion.div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">All tasks</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="liquid-pill flex rounded-full p-1 text-xs shadow-sm">
                <button
                  onClick={() => setViewMode("list")}
                  className={`rounded-full px-3 py-1 transition ${
                    viewMode === "list"
                      ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode("whiteboard")}
                  className={`rounded-full px-3 py-1 transition ${
                    viewMode === "whiteboard"
                      ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Whiteboard
                </button>
                <button
                  onClick={() => setViewMode("dashboard")}
                  className={`rounded-full px-3 py-1 transition ${
                    viewMode === "dashboard"
                      ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Dashboard
                </button>
              </div>
              <div className="liquid-pill flex rounded-full p-1 text-xs shadow-sm">
                {[
                  { id: "focus", label: "Agenda" },
                  { id: "open", label: "Open" },
                  { id: "done", label: "Done" },
                  { id: "all", label: "All" },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() =>
                      setFilterStatus(filter.id as "all" | "open" | "done" | "focus")
                    }
                    className={`rounded-full px-3 py-1 transition ${
                      filterStatus === filter.id
                        ? "bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-300/60"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <input
                className="liquid-input rounded-full px-3 py-2 text-xs text-slate-600 focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                placeholder="Search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>
          {categories.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Assign to category:</span>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <DroppableCategoryPill key={category.id} category={category} />
                ))}
              </div>
            </div>
          ) : null}

          {viewMode === "dashboard" ? (
            <div className="dashboard-display mt-6 grid gap-6 md:grid-cols-3">
              <motion.div
                className="liquid-glass liquid-sheen rounded-[32px] p-6 md:p-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <p className="dashboard-title text-slate-400">
                  Today
                </p>
                <p className="dashboard-metric mt-3 font-semibold text-slate-900">
                  {focusEstimatedTotal} min
                </p>
                <p className="dashboard-label text-slate-500">Reserved focus time</p>
              </motion.div>
              <motion.div
                className="liquid-glass liquid-sheen rounded-[32px] p-6 md:p-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut", delay: 0.05 }}
              >
                <p className="dashboard-title text-slate-400">
                  Tasks
                </p>
                <p className="dashboard-metric mt-3 font-semibold text-slate-900">
                  {tasks.filter((task) => task.status !== "done").length}
                </p>
                <p className="dashboard-label text-slate-500">Open tasks</p>
              </motion.div>
              <motion.div
                className="liquid-glass liquid-sheen rounded-[32px] p-6 md:p-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
              >
                <p className="dashboard-title text-slate-400">
                  Completed
                </p>
                <p className="dashboard-metric mt-3 font-semibold text-slate-900">
                  {tasks.filter((task) => task.status === "done").length}
                </p>
                <p className="dashboard-label text-slate-500">Done tasks</p>
              </motion.div>
              <motion.div
                className="liquid-glass liquid-sheen rounded-[32px] p-6 md:col-span-2 md:p-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
              >
                <p className="dashboard-title text-slate-400">
                  Today&apos;s agenda
                </p>
                <div className="mt-4 grid gap-3">
                  {focusOpenTasks.slice(0, 4).map((task) => (
                    <div
                      key={task.id}
                      className="dashboard-body flex items-center justify-between rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-slate-700"
                    >
                      <span>{task.title}</span>
                      <span className="dashboard-body text-slate-400">
                        {formatMinutes(task.estimated_minutes)}
                      </span>
                    </div>
                  ))}
                  {!focusOpenTasks.length ? (
                    <p className="dashboard-body text-slate-500">No focus tasks yet.</p>
                  ) : null}
                </div>
              </motion.div>
              <motion.div
                className="liquid-glass liquid-sheen rounded-[32px] p-6 md:p-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut", delay: 0.2 }}
              >
                <p className="dashboard-title text-slate-400">
                  Categories
                </p>
                <div className="mt-4 grid gap-3">
                  {categories.slice(0, 6).map((category) => (
                    <div
                      key={category.id}
                      className="dashboard-body flex items-center justify-between text-slate-600"
                    >
                      <span>{category.name}</span>
                      <span className="dashboard-body text-slate-400">
                        {
                          tasks.filter(
                            (task) => task.category?.name === category.name
                          ).length
                        }
                      </span>
                    </div>
                  ))}
                  {!categories.length ? (
                    <p className="dashboard-body text-slate-500">
                      Add your first category.
                    </p>
                  ) : null}
                </div>
              </motion.div>
            </div>
          ) : viewMode === "list" ? (
            <div className="mt-4 grid gap-3">
              {groupedTasks.map((group) => (
                <div key={group.id} className="grid gap-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    {group.label}
                  </p>
                  {group.tasks.map((task) => {
                    const delta =
                      task.actual_minutes && task.estimated_minutes
                        ? task.actual_minutes - task.estimated_minutes
                        : null;
                    return (
                      <DraggableListTask key={task.id} task={task}>
                      <motion.div
                        className="liquid-glass liquid-sheen liquid-card rounded-3xl p-4"
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleDone(task)}
                                className={`h-6 w-6 rounded-full border transition ${
                                  task.status === "done"
                                    ? "border-emerald-400 bg-emerald-400/40"
                                    : "border-slate-300 bg-white/80"
                                }`}
                                aria-label="Toggle done"
                              />
                              {editingId === task.id ? (
                                <input
                                  className="liquid-input rounded-xl px-2 py-1 text-lg font-semibold text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                                  value={editingTitle}
                                  onChange={(event) => setEditingTitle(event.target.value)}
                                  onBlur={() => commitEdit(task)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.currentTarget.blur();
                                    }
                                    if (event.key === "Escape") {
                                      setEditingId(null);
                                      setEditingTitle(task.title);
                                    }
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <button
                                  onClick={() => startEditing(task)}
                                  className={`text-left text-lg font-semibold transition ${
                                    task.status === "done"
                                      ? "line-through text-slate-400"
                                      : "text-slate-900"
                                  }`}
                                >
                                  {task.title}
                                </button>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {task.category?.name ?? "Uncategorized"} · Priority{" "}
                              {priorities.find((p) => p.value === task.priority)?.label}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>Estimate: {formatMinutes(task.estimated_minutes)}</span>
                              {task.actual_minutes ? (
                                <span>Actual: {task.actual_minutes}m</span>
                              ) : null}
                              {delta !== null ? (
                                <span className={delta > 0 ? "text-rose-500" : "text-emerald-500"}>
                                  {delta > 0 ? `+${delta}m` : `${delta}m`}
                                </span>
                              ) : null}
                              {task.estimated_minutes ? (
                                <span>
                                  Suggested: {suggestBlocks(task.estimated_minutes)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <button
                              onClick={() => toggleFocus(task)}
                              className={`rounded-full px-3 py-1 text-xs transition ${
                                task.is_focus
                                  ? "liquid-accent"
                                  : "liquid-pill text-slate-600 hover:text-slate-700"
                              }`}
                            >
                              {task.is_focus ? "On agenda" : "Agenda"}
                            </button>
                            {editingActualId === task.id ? (
                              <input
                                className="liquid-input rounded-full px-3 py-1 text-xs text-slate-600 focus:outline-none focus:ring-4 focus:ring-indigo-200/60"
                                value={editingActualValue}
                                onChange={(event) =>
                                  setEditingActualValue(event.target.value)
                                }
                                onBlur={() => commitActualEdit(task)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    setEditingActualId(null);
                                    setEditingActualValue(
                                      task.actual_minutes?.toString() ?? ""
                                    );
                                  }
                                }}
                                placeholder="Actual min"
                                autoFocus
                              />
                            ) : (
                              <button
                                onClick={() => startActualEdit(task)}
                                className="liquid-pill rounded-full px-3 py-1 text-xs text-slate-600 transition hover:text-slate-700"
                              >
                                {task.actual_minutes ? "Edit actual" : "Log actual"}
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                      </DraggableListTask>
                    );
                  })}
                </div>
              ))}
              {!groupedTasks.length ? (
                <div className="liquid-glass liquid-sheen rounded-3xl p-6 text-center text-slate-500">
                  Add a task to get started.
                </div>
              ) : null}
            </div>
          ) : (
            <motion.div
              className="liquid-glass liquid-sheen mt-4 rounded-3xl p-6 text-slate-900 shadow-inner whiteboard-surface"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className="mb-3 text-xs uppercase tracking-[0.35em] text-slate-400">
                Swipe right for done, left for agenda
              </div>
              <div className="grid gap-0">
                {visibleTasks.map((task) => {
                  const offset = swipeOffsets[task.id] ?? 0;
                  return (
                    <div
                      key={task.id}
                      className="whiteboard-line touch-pan-y select-none"
                      onPointerDown={(event) => handleSwipeStart(task.id, event)}
                      onPointerMove={(event) => handleSwipeMove(task.id, event)}
                      onPointerUp={(event) => handleSwipeEnd(task, event)}
                      onPointerCancel={(event) => handleSwipeEnd(task, event)}
                    >
                      <div
                        className="flex items-center justify-between gap-4 py-3 pl-2 pr-3 transition"
                        style={{ transform: `translateX(${offset}px)` }}
                      >
                        <div>
                          <p
                            className={`text-lg font-semibold ${
                              task.status === "done"
                                ? "line-through text-slate-400"
                                : "text-slate-900"
                            }`}
                          >
                            {task.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {task.category?.name ?? "Uncategorized"} · Priority{" "}
                            {priorities.find((p) => p.value === task.priority)?.label}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400">
                          {task.status === "done" ? "Done" : "Open"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!visibleTasks.length ? (
                  <div className="liquid-glass liquid-sheen rounded-3xl p-6 text-center text-slate-500">
                    Add a task to get started.
                  </div>
                ) : null}
              </div>
            </motion.div>
          )}
        </section>
        </DndContext>
        {notifications.length ? (
          <div className="pointer-events-none fixed inset-x-4 bottom-6 z-50 flex flex-col gap-2 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-80">
            {notifications.map((item) => (
              <div
                key={item.id}
                className={`pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
                  item.tone === "success"
                    ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                    : item.tone === "error"
                    ? "border-rose-200 bg-rose-50/90 text-rose-700"
                    : item.tone === "alarm"
                    ? "animate-pulse border-amber-300 bg-amber-50/95 text-amber-800 ring-2 ring-amber-400"
                    : "border-slate-200 bg-white/90 text-slate-700"
                }`}
              >
                {item.message}
              </div>
            ))}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
