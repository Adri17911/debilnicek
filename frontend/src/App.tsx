import { useEffect, useMemo, useState } from "react";
import { categoryApi, taskApi } from "./api";
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

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(emptyTask);
  const [categorySelection, setCategorySelection] = useState("Work");
  const [newCategory, setNewCategory] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [focusOnly, setFocusOnly] = useState(false);

  const focusTasks = useMemo(
    () => tasks.filter((task) => task.is_focus),
    [tasks]
  );

  const visibleTasks = useMemo(() => {
    let filtered = tasks;
    if (!showCompleted) {
      filtered = filtered.filter((task) => task.status !== "done");
    }
    if (focusOnly) {
      filtered = filtered.filter((task) => task.is_focus);
    }
    return filtered;
  }, [tasks, showCompleted, focusOnly]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [taskData, categoryData] = await Promise.all([
      taskApi.list(),
      categoryApi.list(),
    ]);
    setTasks(taskData);
    setCategories(categoryData);
    if (categoryData.length) {
      setCategorySelection(categoryData[0].name);
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

    const created = await taskApi.create(payload);
    setTasks((prev) => [created, ...prev]);
    setForm(emptyTask);
    setNewCategory("");
  };

  const toggleDone = async (task: Task) => {
    const updated = await taskApi.update(task.id, {
      status: task.status === "done" ? "open" : "done",
    });
    setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
  };

  const toggleFocus = async (task: Task) => {
    const updated = await taskApi.update(task.id, { is_focus: !task.is_focus });
    setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            FocusFlow
          </p>
          <h1 className="text-3xl font-semibold">
            Gentle, ADHD-friendly task flow
          </h1>
          <p className="text-slate-400">
            Capture fast, decide priority, and keep your top three in focus.
          </p>
        </header>

        <section className="mt-8 grid gap-4 rounded-2xl bg-slate-900/60 p-6 shadow-lg">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-300">Quick capture</label>
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg focus:border-slate-500 focus:outline-none"
              placeholder="What do you want to remember?"
              value={form.title}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <span className="text-sm text-slate-300">Priority</span>
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
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${
                      form.priority === priority.value
                        ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                        : "border-slate-700 bg-slate-950 text-slate-300"
                    }`}
                  >
                    {priority.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-slate-300">Category</span>
              <select
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
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
              <span className="text-sm text-slate-300">Estimate (minutes)</span>
              <input
                type="number"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
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

          {categorySelection === "__new__" ? (
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm"
              placeholder="Name your new category"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
          ) : null}

          <button
            onClick={handleCreate}
            className="rounded-xl bg-indigo-500 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400"
          >
            Add task
          </button>
        </section>

        <section className="mt-8 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Today focus</h2>
              <p className="text-sm text-slate-400">
                Keep no more than three tasks here to reduce overload.
              </p>
            </div>
            <button
              onClick={() => setFocusOnly((prev) => !prev)}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300"
            >
              {focusOnly ? "Show all tasks" : "Show focus only"}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {focusTasks.length ? (
              focusTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-indigo-500/40 bg-indigo-500/10 p-4"
                >
                  <p className="text-lg font-semibold">{task.title}</p>
                  <p className="text-xs text-indigo-200">
                    {task.category?.name ?? "Uncategorized"}
                  </p>
                </div>
              ))
            ) : (
              <div className="col-span-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
                Pick up to three tasks to anchor your day.
              </div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">All tasks</h2>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />
              Show completed
            </label>
          </div>

          <div className="mt-4 grid gap-3">
            {visibleTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleDone(task)}
                        className={`h-6 w-6 rounded-full border ${
                          task.status === "done"
                            ? "border-emerald-400 bg-emerald-400/30"
                            : "border-slate-600"
                        }`}
                        aria-label="Toggle done"
                      />
                      <p
                        className={`text-lg font-semibold ${
                          task.status === "done" ? "line-through text-slate-500" : ""
                        }`}
                      >
                        {task.title}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {task.category?.name ?? "Uncategorized"} · Priority{" "}
                      {priorities.find((p) => p.value === task.priority)?.label}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleFocus(task)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        task.is_focus
                          ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                          : "border-slate-700 text-slate-300"
                      }`}
                    >
                      {task.is_focus ? "Focused" : "Focus"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!visibleTasks.length ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center text-slate-400">
                Nothing here yet. Add a task above or invite your task email to a
                calendar event.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
