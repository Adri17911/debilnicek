import os
from datetime import datetime

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    color = db.Column(db.String(20), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "created_at": self.created_at.isoformat(),
        }


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default="open")
    priority = db.Column(db.Integer, default=2)
    due_at = db.Column(db.DateTime, nullable=True)
    estimated_minutes = db.Column(db.Integer, nullable=True)
    is_focus = db.Column(db.Boolean, default=False)
    focus_rank = db.Column(db.Integer, nullable=True)
    source = db.Column(db.String(40), default="manual")

    event_uid = db.Column(db.String(120), nullable=True)
    event_start = db.Column(db.DateTime, nullable=True)
    event_end = db.Column(db.DateTime, nullable=True)
    event_attendees = db.Column(db.Text, nullable=True)

    category_id = db.Column(db.Integer, db.ForeignKey("category.id"), nullable=True)
    category = db.relationship("Category", backref=db.backref("tasks", lazy=True))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "priority": self.priority,
            "due_at": self.due_at.isoformat() if self.due_at else None,
            "estimated_minutes": self.estimated_minutes,
            "is_focus": self.is_focus,
            "focus_rank": self.focus_rank,
            "source": self.source,
            "event_uid": self.event_uid,
            "event_start": self.event_start.isoformat() if self.event_start else None,
            "event_end": self.event_end.isoformat() if self.event_end else None,
            "event_attendees": self.event_attendees,
            "category": self.category.to_dict() if self.category else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


def parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def create_app():
    app = Flask(__name__)
    CORS(app)

    db_url = os.getenv("DATABASE_URL", "sqlite:////data/todos.db")
    app.config["SQLALCHEMY_DATABASE_URI"] = db_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    with app.app_context():
        db.create_all()
        ensure_default_categories()

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/categories")
    def list_categories():
        categories = Category.query.order_by(Category.name.asc()).all()
        return jsonify([cat.to_dict() for cat in categories])

    @app.post("/api/categories")
    def create_category():
        payload = request.get_json(force=True)
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        existing = Category.query.filter_by(name=name).first()
        if existing:
            return jsonify(existing.to_dict()), 200
        category = Category(name=name, color=payload.get("color"))
        db.session.add(category)
        db.session.commit()
        return jsonify(category.to_dict()), 201

    @app.patch("/api/categories/<int:category_id>")
    def update_category(category_id):
        payload = request.get_json(force=True)
        category = Category.query.get_or_404(category_id)
        if "name" in payload:
            name = (payload.get("name") or "").strip()
            if not name:
                return jsonify({"error": "name cannot be empty"}), 400
            category.name = name
        if "color" in payload:
            category.color = payload.get("color")
        db.session.commit()
        return jsonify(category.to_dict())

    @app.delete("/api/categories/<int:category_id>")
    def delete_category(category_id):
        category = Category.query.get_or_404(category_id)
        db.session.delete(category)
        db.session.commit()
        return jsonify({"status": "deleted"})

    @app.get("/api/tasks")
    def list_tasks():
        query = Task.query

        status = request.args.get("status")
        if status:
            query = query.filter(Task.status == status)

        category_id = request.args.get("category_id")
        if category_id:
            query = query.filter(Task.category_id == int(category_id))

        priority = request.args.get("priority")
        if priority:
            query = query.filter(Task.priority == int(priority))

        search = request.args.get("search")
        if search:
            like = f"%{search}%"
            query = query.filter(Task.title.ilike(like))

        focus_only = request.args.get("focus") == "1"
        if focus_only:
            query = query.filter(Task.is_focus.is_(True))

        tasks = query.order_by(Task.is_focus.desc(), Task.updated_at.desc()).all()
        return jsonify([task.to_dict() for task in tasks])

    @app.post("/api/tasks")
    def create_task():
        payload = request.get_json(force=True)
        title = (payload.get("title") or "").strip()
        if not title:
            return jsonify({"error": "title is required"}), 400

        category = resolve_category(payload)
        task = Task(
            title=title,
            description=payload.get("description"),
            status=payload.get("status", "open"),
            priority=int(payload.get("priority", 2)),
            due_at=parse_datetime(payload.get("due_at")),
            estimated_minutes=payload.get("estimated_minutes"),
            is_focus=bool(payload.get("is_focus", False)),
            focus_rank=payload.get("focus_rank"),
            source=payload.get("source", "manual"),
            event_uid=payload.get("event_uid"),
            event_start=parse_datetime(payload.get("event_start")),
            event_end=parse_datetime(payload.get("event_end")),
            event_attendees=payload.get("event_attendees"),
            category=category,
        )
        db.session.add(task)
        db.session.commit()
        return jsonify(task.to_dict()), 201

    @app.patch("/api/tasks/<int:task_id>")
    def update_task(task_id):
        payload = request.get_json(force=True)
        task = Task.query.get_or_404(task_id)

        if "title" in payload:
            title = (payload.get("title") or "").strip()
            if not title:
                return jsonify({"error": "title cannot be empty"}), 400
            task.title = title
        if "description" in payload:
            task.description = payload.get("description")
        if "status" in payload:
            task.status = payload.get("status")
        if "priority" in payload:
            task.priority = int(payload.get("priority"))
        if "due_at" in payload:
            task.due_at = parse_datetime(payload.get("due_at"))
        if "estimated_minutes" in payload:
            task.estimated_minutes = payload.get("estimated_minutes")
        if "is_focus" in payload:
            task.is_focus = bool(payload.get("is_focus"))
        if "focus_rank" in payload:
            task.focus_rank = payload.get("focus_rank")

        if "category_id" in payload or "category_name" in payload:
            task.category = resolve_category(payload)

        db.session.commit()
        return jsonify(task.to_dict())

    @app.delete("/api/tasks/<int:task_id>")
    def delete_task(task_id):
        task = Task.query.get_or_404(task_id)
        db.session.delete(task)
        db.session.commit()
        return jsonify({"status": "deleted"})

    @app.post("/api/inbox/calendar")
    def inbox_calendar():
        payload = request.get_json(force=True)
        title = (payload.get("summary") or "Calendar event").strip()
        category_name = payload.get("category_name")
        category = resolve_category({"category_name": category_name}) if category_name else None

        task = Task(
            title=title,
            description=payload.get("description"),
            status="open",
            priority=int(payload.get("priority", 2)),
            due_at=parse_datetime(payload.get("due_at")),
            estimated_minutes=payload.get("estimated_minutes"),
            is_focus=bool(payload.get("is_focus", False)),
            focus_rank=payload.get("focus_rank"),
            source="calendar_invite",
            event_uid=payload.get("uid"),
            event_start=parse_datetime(payload.get("start")),
            event_end=parse_datetime(payload.get("end")),
            event_attendees=payload.get("attendees"),
            category=category,
        )
        db.session.add(task)
        db.session.commit()
        return jsonify(task.to_dict()), 201

    return app


def ensure_default_categories():
    defaults = ["Work", "Personal"]
    for name in defaults:
        existing = Category.query.filter_by(name=name).first()
        if not existing:
            db.session.add(Category(name=name))
    db.session.commit()


def resolve_category(payload):
    category_id = payload.get("category_id")
    category_name = (payload.get("category_name") or "").strip()

    if category_id:
        return Category.query.get(category_id)
    if category_name:
        existing = Category.query.filter_by(name=category_name).first()
        if existing:
            return existing
        category = Category(name=category_name)
        db.session.add(category)
        db.session.commit()
        return category
    return None


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
