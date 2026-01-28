export type Category = {
  id: number;
  name: string;
  color?: string | null;
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: "open" | "done" | "snoozed";
  priority: 1 | 2 | 3;
  due_at?: string | null;
  estimated_minutes?: number | null;
  actual_minutes?: number | null;
  is_focus: boolean;
  focus_rank?: number | null;
  source: string;
  event_uid?: string | null;
  event_start?: string | null;
  event_end?: string | null;
  event_attendees?: string | null;
  category?: Category | null;
  category_name?: string;
};
