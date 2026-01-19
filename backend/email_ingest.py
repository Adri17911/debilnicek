import os
import re
import sys
import time
from email import message_from_bytes
from email.policy import default

import requests
from aiosmtpd.controller import Controller
from icalendar import Calendar


BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:5000")
INGEST_RECIPIENT = os.getenv("INGEST_RECIPIENT")
LISTEN_HOST = os.getenv("SMTP_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("SMTP_PORT", "8025"))


def extract_ics(message):
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            if content_type == "text/calendar":
                return part.get_payload(decode=True)
            filename = part.get_filename() or ""
            if filename.lower().endswith(".ics"):
                return part.get_payload(decode=True)
    return None


def parse_calendar(ics_bytes):
    calendar = Calendar.from_ical(ics_bytes)
    for component in calendar.walk():
        if component.name == "VEVENT":
            uid = str(component.get("uid", ""))
            summary = str(component.get("summary", "Calendar event"))
            description = str(component.get("description", "")) or None
            dtstart = component.get("dtstart")
            dtend = component.get("dtend")
            attendees = component.get("attendee", [])
            if not isinstance(attendees, list):
                attendees = [attendees]
            attendee_str = ", ".join([str(a) for a in attendees]) or None
            return {
                "uid": uid,
                "summary": summary,
                "description": description,
                "start": dtstart.dt.isoformat() if dtstart else None,
                "end": dtend.dt.isoformat() if dtend else None,
                "attendees": attendee_str,
            }
    return None


def recipient_allowed(envelope):
    if not INGEST_RECIPIENT:
        return True
    return any(
        re.fullmatch(INGEST_RECIPIENT, rcpt, flags=re.IGNORECASE)
        for rcpt in envelope.rcpt_tos
    )


class CalendarHandler:
    async def handle_DATA(self, server, session, envelope):
        if not recipient_allowed(envelope):
            return "550 recipient not allowed"

        message = message_from_bytes(envelope.content, policy=default)
        ics_bytes = extract_ics(message)
        if not ics_bytes:
            return "250 no calendar attachment"

        event = parse_calendar(ics_bytes)
        if not event:
            return "250 no event found"

        try:
            response = requests.post(
                f"{BACKEND_URL}/api/inbox/calendar", json=event, timeout=5
            )
            response.raise_for_status()
        except Exception as exc:
            print(f"Failed to send event to backend: {exc}", file=sys.stderr)
            return "451 failed to ingest"

        return "250 message accepted for delivery"


def main():
    controller = Controller(CalendarHandler(), hostname=LISTEN_HOST, port=LISTEN_PORT)
    controller.start()
    print(f"SMTP ingest listening on {LISTEN_HOST}:{LISTEN_PORT}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        controller.stop()


if __name__ == "__main__":
    main()
