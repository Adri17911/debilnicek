import os
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from werkzeug.security import check_password_hash, generate_password_hash


db = SQLAlchemy()


class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    color = db.Column(db.String(20), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint("name", "user_id", name="uq_category_name_user"),)

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
    actual_minutes = db.Column(db.Integer, nullable=True)
    is_focus = db.Column(db.Boolean, default=False)
    focus_rank = db.Column(db.Integer, nullable=True)
    source = db.Column(db.String(40), default="manual")

    event_uid = db.Column(db.String(120), nullable=True)
    event_start = db.Column(db.DateTime, nullable=True)
    event_end = db.Column(db.DateTime, nullable=True)
    event_attendees = db.Column(db.Text, nullable=True)

    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
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
            "actual_minutes": self.actual_minutes,
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


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    verification_token = db.Column(db.String(120), nullable=True)
    verified_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "username": self.username,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "created_at": self.created_at.isoformat(),
        }


class Session(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    token = db.Column(db.String(120), unique=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


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
        ensure_task_columns()
        ensure_auth_columns()
        ensure_default_categories()

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.post("/api/auth/register")
    def register():
        payload = request.get_json(force=True)
        email = (payload.get("email") or "").strip().lower()
        username = (payload.get("username") or "").strip()
        password = payload.get("password") or ""
        if not email or not username or not password:
            return jsonify({"error": "email, username, and password are required"}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "email already registered"}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({"error": "username already registered"}), 400
        verification_token = secrets.token_urlsafe(32)
        user = User(
            email=email,
            username=username,
            password_hash=generate_password_hash(password),
            verification_token=verification_token,
        )
        db.session.add(user)
        db.session.commit()

        assign_unowned_records(user.id)
        send_verification_email(user, verification_token)
        response = {"status": "verification_sent"}
        if os.getenv("APP_ENV", "development") != "production":
            response["verification_link"] = build_verification_link(verification_token)
        return jsonify(response), 201

    @app.post("/api/auth/login")
    def login():
        payload = request.get_json(force=True)
        identifier = (payload.get("identifier") or "").strip()
        password = payload.get("password") or ""
        if not identifier or not password:
            return jsonify({"error": "identifier and password are required"}), 400
        user = User.query.filter(
            (User.email == identifier.lower()) | (User.username == identifier)
        ).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "invalid credentials"}), 401
        if not user.verified_at:
            return jsonify({"error": "email not verified"}), 403
        token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(days=30)
        session = Session(user_id=user.id, token=token, expires_at=expires_at)
        db.session.add(session)
        db.session.commit()
        return jsonify({"token": token, "user": user.to_dict()})

    @app.get("/api/auth/verify")
    def verify_email():
        token = request.args.get("token")
        if not token:
            return jsonify({"error": "token is required"}), 400
        user = User.query.filter_by(verification_token=token).first()
        if not user:
            return jsonify({"error": "invalid token"}), 404
        user.verified_at = datetime.utcnow()
        user.verification_token = None
        db.session.commit()
        return jsonify({"status": "verified"})

    @app.post("/api/auth/resend")
    def resend_verification():
        payload = request.get_json(force=True)
        email = (payload.get("email") or "").strip().lower()
        if not email:
            return jsonify({"error": "email is required"}), 400
        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"error": "email not found"}), 404
        if user.verified_at:
            return jsonify({"status": "already_verified"}), 200
        token = user.verification_token or secrets.token_urlsafe(32)
        user.verification_token = token
        db.session.commit()
        send_verification_email(user, token)
        response = {"status": "verification_sent"}
        if os.getenv("APP_ENV", "development") != "production":
            response["verification_link"] = build_verification_link(token)
        return jsonify(response)

    @app.get("/api/auth/me")
    def me():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        return jsonify(user.to_dict())

    @app.post("/api/auth/logout")
    def logout():
        token = extract_token()
        if not token:
            return jsonify({"status": "ok"})
        Session.query.filter_by(token=token).delete()
        db.session.commit()
        return jsonify({"status": "ok"})

    @app.patch("/api/auth/profile")
    def update_profile():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True)
        current_password = payload.get("current_password") or ""
        if not check_password_hash(user.password_hash, current_password):
            return jsonify({"error": "invalid password"}), 403
        new_email = (payload.get("email") or user.email).strip().lower()
        new_username = (payload.get("username") or user.username).strip()

        if new_email != user.email and User.query.filter_by(email=new_email).first():
            return jsonify({"error": "email already registered"}), 400
        if new_username != user.username and User.query.filter_by(username=new_username).first():
            return jsonify({"error": "username already registered"}), 400

        email_changed = new_email != user.email
        user.email = new_email
        user.username = new_username
        if email_changed:
            token = secrets.token_urlsafe(32)
            user.verification_token = token
            user.verified_at = None
            send_verification_email(user, token)
        db.session.commit()
        response = {"user": user.to_dict(), "status": "updated"}
        if email_changed and os.getenv("APP_ENV", "development") != "production":
            response["verification_link"] = build_verification_link(user.verification_token)
        return jsonify(response)

    @app.post("/api/auth/password")
    def change_password():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True)
        current_password = payload.get("current_password") or ""
        new_password = payload.get("new_password") or ""
        if not check_password_hash(user.password_hash, current_password):
            return jsonify({"error": "invalid password"}), 403
        if len(new_password) < 8:
            return jsonify({"error": "password too short"}), 400
        user.password_hash = generate_password_hash(new_password)
        db.session.commit()
        return jsonify({"status": "password_updated"})

    @app.delete("/api/auth/account")
    def delete_account():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True) if request.data else {}
        current_password = payload.get("current_password") or ""
        if not check_password_hash(user.password_hash, current_password):
            return jsonify({"error": "invalid password"}), 403
        Session.query.filter_by(user_id=user.id).delete()
        Task.query.filter_by(user_id=user.id).delete()
        Category.query.filter_by(user_id=user.id).delete()
        db.session.delete(user)
        db.session.commit()
        return jsonify({"status": "deleted"})

    @app.get("/api/categories")
    def list_categories():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        categories = (
            Category.query.filter_by(user_id=user.id).order_by(Category.name.asc()).all()
        )
        return jsonify([cat.to_dict() for cat in categories])

    @app.post("/api/categories")
    def create_category():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True)
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        existing = Category.query.filter_by(name=name, user_id=user.id).first()
        if existing:
            return jsonify(existing.to_dict()), 200
        category = Category(name=name, color=payload.get("color"), user_id=user.id)
        db.session.add(category)
        db.session.commit()
        return jsonify(category.to_dict()), 201

    @app.patch("/api/categories/<int:category_id>")
    def update_category(category_id):
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True)
        category = Category.query.filter_by(id=category_id, user_id=user.id).first()
        if not category:
            return jsonify({"error": "not found"}), 404
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
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        category = Category.query.filter_by(id=category_id, user_id=user.id).first()
        if not category:
            return jsonify({"error": "not found"}), 404
        db.session.delete(category)
        db.session.commit()
        return jsonify({"status": "deleted"})

    @app.get("/api/tasks")
    def list_tasks():
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        query = Task.query.filter_by(user_id=user.id)

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
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True)
        title = (payload.get("title") or "").strip()
        if not title:
            return jsonify({"error": "title is required"}), 400

        category = resolve_category(payload, user.id)
        task = Task(
            title=title,
            description=payload.get("description"),
            status=payload.get("status", "open"),
            priority=int(payload.get("priority", 2)),
            due_at=parse_datetime(payload.get("due_at")),
            estimated_minutes=payload.get("estimated_minutes"),
            actual_minutes=payload.get("actual_minutes"),
            is_focus=bool(payload.get("is_focus", False)),
            focus_rank=payload.get("focus_rank"),
            source=payload.get("source", "manual"),
            event_uid=payload.get("event_uid"),
            event_start=parse_datetime(payload.get("event_start")),
            event_end=parse_datetime(payload.get("event_end")),
            event_attendees=payload.get("event_attendees"),
            user_id=user.id,
            category=category,
        )
        db.session.add(task)
        db.session.commit()
        return jsonify(task.to_dict()), 201

    @app.patch("/api/tasks/<int:task_id>")
    def update_task(task_id):
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        payload = request.get_json(force=True)
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()
        if not task:
            return jsonify({"error": "not found"}), 404

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
        if "actual_minutes" in payload:
            task.actual_minutes = payload.get("actual_minutes")
        if "is_focus" in payload:
            task.is_focus = bool(payload.get("is_focus"))
        if "focus_rank" in payload:
            task.focus_rank = payload.get("focus_rank")

        if "category_id" in payload or "category_name" in payload:
            task.category = resolve_category(payload, user.id)

        db.session.commit()
        return jsonify(task.to_dict())

    @app.delete("/api/tasks/<int:task_id>")
    def delete_task(task_id):
        user = require_auth()
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()
        if not task:
            return jsonify({"error": "not found"}), 404
        db.session.delete(task)
        db.session.commit()
        return jsonify({"status": "deleted"})

    @app.post("/api/inbox/calendar")
    def inbox_calendar():
        payload = request.get_json(force=True)
        title = (payload.get("summary") or "Calendar event").strip()
        category_name = payload.get("category_name")
        default_user = get_default_user()
        category = (
            resolve_category({"category_name": category_name}, default_user.id)
            if category_name and default_user
            else None
        )

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
            user_id=default_user.id if default_user else None,
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


def ensure_task_columns():
    inspector = db.session.execute(text("PRAGMA table_info(task)")).fetchall()
    columns = {row[1] for row in inspector}
    if "actual_minutes" not in columns:
        db.session.execute(text("ALTER TABLE task ADD COLUMN actual_minutes INTEGER"))
        db.session.commit()
    if "user_id" not in columns:
        db.session.execute(text("ALTER TABLE task ADD COLUMN user_id INTEGER"))
        db.session.commit()

def ensure_auth_columns():
    inspector = db.session.execute(text("PRAGMA table_info(category)")).fetchall()
    columns = {row[1] for row in inspector}
    if "user_id" not in columns:
        db.session.execute(text("ALTER TABLE category ADD COLUMN user_id INTEGER"))
        db.session.commit()

    index_list = db.session.execute(text("PRAGMA index_list(category)")).fetchall()
    has_name_unique = False
    for idx in index_list:
        if not idx[2]:
            continue
        idx_name = idx[1]
        columns_info = db.session.execute(text(f"PRAGMA index_info({idx_name})")).fetchall()
        indexed_cols = [col[2] for col in columns_info]
        if indexed_cols == ["name"]:
            has_name_unique = True
            break

    if has_name_unique:
        db.session.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS category_new (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR(80) NOT NULL,
                    color VARCHAR(20),
                    user_id INTEGER,
                    created_at DATETIME
                )
                """
            )
        )
        db.session.execute(
            text(
                """
                INSERT INTO category_new (id, name, color, user_id, created_at)
                SELECT id, name, color, user_id, created_at FROM category
                """
            )
        )
        db.session.execute(text("DROP TABLE category"))
        db.session.execute(text("ALTER TABLE category_new RENAME TO category"))
        db.session.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_category_name_user ON category (name, user_id)"
            )
        )
        db.session.commit()


def resolve_category(payload, user_id):
    category_id = payload.get("category_id")
    category_name = (payload.get("category_name") or "").strip()

    if category_id:
        return Category.query.filter_by(id=category_id, user_id=user_id).first()
    if category_name:
        existing = Category.query.filter_by(
            name=category_name, user_id=user_id
        ).first()
        if existing:
            return existing
        category = Category(name=category_name, user_id=user_id)
        db.session.add(category)
        db.session.commit()
        return category
    return None


def assign_unowned_records(user_id):
    db.session.execute(
        text("UPDATE task SET user_id = :user_id WHERE user_id IS NULL"),
        {"user_id": user_id},
    )
    db.session.execute(
        text("UPDATE category SET user_id = :user_id WHERE user_id IS NULL"),
        {"user_id": user_id},
    )
    db.session.commit()


def extract_token():
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return request.headers.get("X-Auth-Token")


def require_auth():
    token = extract_token()
    if not token:
        return None
    session = Session.query.filter_by(token=token).first()
    if not session or session.expires_at < datetime.utcnow():
        return None
    return User.query.get(session.user_id)


def get_default_user():
    return User.query.order_by(User.created_at.asc()).first()


def build_verification_link(token):
    base_url = os.getenv("PUBLIC_BASE_URL", "http://localhost:8080")
    return f"{base_url}/?verify={token}"


def send_verification_email(user, token):
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM", "FocusFlow <no-reply@focusflow.local>")
    verification_link = build_verification_link(token)
    subject = "Verify your FocusFlow account"
    body = f"Hello {user.username},\\n\\nVerify your account: {verification_link}\\n\\n"

    if not smtp_host:
        print(f"[verification] {verification_link}")
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_from
    message["To"] = user.email
    message.set_content(body)

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)
        server.send_message(message)


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
