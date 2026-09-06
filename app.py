import os
import re
import json
import base64
from datetime import datetime
from urllib.parse import quote

from flask import Flask, jsonify, render_template
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from dateutil import parser as date_parser
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.cloud import secretmanager
from google.cloud import firestore
from groq import Groq

app = Flask(__name__)
load_dotenv()

groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# ==========================================================
# CONFIG
# ==========================================================

PROJECT_ID = "school-assistant-499518"

db = firestore.Client(project=PROJECT_ID)

SECRET_NAME = "gmail-token"
LABEL_NAME = "DianaSchool"

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

FIRESTORE_COLLECTION = "emails"


# ==========================================================
# SECRET MANAGER
# ==========================================================


def get_gmail_credentials():
    """
    Read the Gmail OAuth token from Google Secret Manager.
    """

    client = secretmanager.SecretManagerServiceClient()

    secret_path = f"projects/{PROJECT_ID}" f"/secrets/{SECRET_NAME}" f"/versions/latest"

    response = client.access_secret_version(request={"name": secret_path})

    token_data = response.payload.data.decode("utf-8")
    token_info = json.loads(token_data)

    return Credentials.from_authorized_user_info(token_info, SCOPES)


# ==========================================================
# GMAIL
# ==========================================================


def get_gmail_service():

    creds = get_gmail_credentials()

    if not creds.valid:

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())

        else:
            raise RuntimeError("Gmail credentials are invalid and cannot be refreshed.")

    return build("gmail", "v1", credentials=creds)


def get_authenticated_gmail_account(service):
    """
    Ask the Gmail API which account the current OAuth token belongs to,
    instead of hard-coding an address. Requires no scopes beyond the
    existing gmail.readonly grant.
    """

    profile = service.users().getProfile(userId="me").execute()

    return profile.get("emailAddress")


# ==========================================================
# GMAIL URL
# ==========================================================


def build_gmail_url(gmail_account, thread_or_message_id):
    """
    Build a link to the original Gmail thread/message.

    We deliberately avoid https://mail.google.com/mail/u/<index>/... links:
    the /u/0, /u/1, ... position depends on the order Google accounts are
    signed into in the current browser, which is not something this app
    can know or control. Instead we pass the account explicitly via the
    ?authuser=<email> query param, which Gmail resolves by address rather
    than position regardless of sign-in order.

    Limitation: if the browser isn't signed into `gmail_account` at all,
    Gmail will prompt the user to sign in/choose an account rather than
    silently switching for them - there is no way around that from a URL.
    """

    if not thread_or_message_id:
        return None

    if gmail_account:
        return (
            f"https://mail.google.com/mail/?authuser={quote(gmail_account)}"
            f"#all/{thread_or_message_id}"
        )

    return f"https://mail.google.com/mail/#all/{thread_or_message_id}"


def get_email_gmail_url(email):
    """
    Resolve the Gmail deep link for a stored email record. Older records
    may be missing gmail_thread_id/gmail_account (added by this feature);
    fall back to the legacy thread_id field, then to the message id itself,
    and finally to no link at all if nothing usable is stored.
    """

    thread_or_message_id = (
        email.get("gmail_thread_id")
        or email.get("thread_id")
        or email.get("gmail_id")
    )

    return build_gmail_url(email.get("gmail_account"), thread_or_message_id)


# ==========================================================
# FIRESTORE
# ==========================================================


def get_firestore_client():
    return firestore.Client(project=PROJECT_ID)


def email_exists(db, gmail_id):
    doc_ref = db.collection(FIRESTORE_COLLECTION).document(gmail_id)

    return doc_ref.get().exists


def save_email(db, email):
    doc_ref = db.collection(FIRESTORE_COLLECTION).document(email["gmail_id"])

    doc_ref.set(email)


# ==========================================================
# LABEL
# ==========================================================


def get_label_id(service):

    labels = service.users().labels().list(userId="me").execute()

    for label in labels.get("labels", []):

        if label["name"].lower() == LABEL_NAME.lower():
            return label["id"]

    return None


# ==========================================================
# BASE64
# ==========================================================


def decode_base64(data):

    if not data:
        return ""

    return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")


# ==========================================================
# BODY EXTRACTION
# ==========================================================


def extract_body(payload):

    mime_type = payload.get("mimeType", "")

    # Plain text
    if mime_type == "text/plain":

        data = payload.get("body", {}).get("data")

        if data:
            return decode_base64(data)

    # HTML
    if mime_type == "text/html":

        data = payload.get("body", {}).get("data")

        if data:

            html = decode_base64(data)

            soup = BeautifulSoup(html, "html.parser")

            return soup.get_text(separator="\n", strip=True)

    # Multipart
    for part in payload.get("parts", []):

        body = extract_body(part)

        if body:
            return body

    return ""


# ==========================================================
# CLEANING
# ==========================================================


def clean_body(text):

    if not text:
        return ""

    text = text.replace("\r", "")

    lines = text.split("\n")

    cleaned = []

    skip_patterns = [
        "notification settings",
        "google llc",
        "unsubscribe",
        "see details",
        "posted on",
        "mountain view",
        "this email was sent to you because",
        "if you don't want to receive emails like this",
    ]

    for line in lines:

        line = line.strip()

        if not line:
            continue

        # Remove direct URLs
        if line.startswith("http"):
            continue

        if "<http" in line.lower():
            continue

        lower = line.lower()

        if any(pattern in lower for pattern in skip_patterns):
            continue

        cleaned.append(line)

    text = "\n".join(cleaned)

    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


# ==========================================================
# HEADERS
# ==========================================================


def get_header(headers, name):

    for header in headers:

        if header["name"].lower() == name.lower():
            return header["value"]

    return ""


# ==========================================================
# READ SCHOOL EMAILS
# ==========================================================


def get_school_emails():

    service = get_gmail_service()

    label_id = get_label_id(service)

    if not label_id:

        raise RuntimeError(f"Label '{LABEL_NAME}' not found in Gmail.")

    results = (
        service.users()
        .messages()
        .list(userId="me", labelIds=[label_id], maxResults=500)
        .execute()
    )

    messages = results.get("messages", [])

    return service, messages


# ==========================================================
# PROCESS + SAVE
# ==========================================================


def process_school_emails():

    service, messages = get_school_emails()

    gmail_account = get_authenticated_gmail_account(service)

    db = get_firestore_client()

    new_count = 0
    existing_count = 0

    for msg in messages:

        gmail_id = msg["id"]

        # Avoid duplicate emails
        if email_exists(db, gmail_id):

            existing_count += 1
            continue

        full_email = (
            service.users()
            .messages()
            .get(userId="me", id=gmail_id, format="full")
            .execute()
        )

        payload = full_email["payload"]

        headers = payload.get("headers", [])

        subject = get_header(headers, "Subject")

        sender = get_header(headers, "From")

        date = get_header(headers, "Date")

        body_raw = extract_body(payload)

        body_clean = clean_body(body_raw)

        record = {
            "gmail_id": gmail_id,
            "thread_id": full_email.get("threadId"),
            "gmail_thread_id": full_email.get("threadId"),
            "gmail_account": gmail_account,
            "subject": subject,
            "from": sender,
            "date": date,
            "body_raw": body_raw,
            "body_clean": body_clean,
            # AI fields
            "ai_processed": False,
	    "category": None,
            "ai_summary": None,
            "action_required": None,
            "priority": None,
            "deadline": None,
            "event_date": None,
        }

        save_email(db, record)

        new_count += 1

    return {
        "found": len(messages),
        "new": new_count,
        "existing": existing_count,
        "gmail_account": gmail_account,
    }


# ==========================================================
# AI TEST
# ==========================================================


def analyze_email(email):

    prompt = f"""
You are a school assistant helping a parent understand school emails.

Analyze the email below.

Return ONLY valid JSON with exactly these fields:

{{
  "category": "other",
  "ai_summary": "A concise summary of the email.",
  "action_required": true,
  "priority": "high",
  "deadline": null,
  "event_date": null
}}

Rules:

- Do not invent information.
- category must be exactly one of:
  fees, uniform, event, academic, cafeteria, announcement, classroom, homework, other.
- classroom is for general Google Classroom posts: new material, announcements, schedules, invitations.
- homework is specifically for assigned work with something the student must complete, e.g. an assignment, worksheet, or project, especially if it has a due date.
- action_required must be true or false.
- priority must be one of: high, medium, low.
- deadline must be a date explicitly mentioned in the email, otherwise null.
- event_date must be a date explicitly mentioned in the email, otherwise null.
- If the email is purely informational, action_required should be false.

EMAIL:

Subject: {email.get("subject", "")}

From: {email.get("from", "")}

Date: {email.get("date", "")}

Body:

{email.get("body_clean", "")}
"""

    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    result = response.choices[0].message.content.strip()

    return json.loads(result)


# ==========================================================
# PROCESS AI FOR ALL UNPROCESSED EMAILS
# ==========================================================


def process_ai_emails(limit=3):

    docs = (
        db.collection("emails")
        .where("ai_processed", "==", False)
        .limit(limit)
        .stream()
    )

    processed_count = 0
    skipped_count = 0
    errors = []

    for doc in docs:

        email = doc.to_dict()

        try:

            analysis = analyze_email(email)

            db.collection("emails").document(doc.id).update(
                {
                    "ai_processed": True,
                    "category": analysis.get("category", "other"),
                    "ai_summary": analysis.get("ai_summary"),
                    "action_required": analysis.get("action_required"),
                    "priority": analysis.get("priority"),
                    "deadline": analysis.get("deadline"),
                    "event_date": analysis.get("event_date"),
                }
            )

            processed_count += 1

            print(
                f"AI processed: {email.get('subject', '')}"
            )

        except Exception as e:

            error_text = str(e)

            print(
                f"AI failed: {email.get('subject', '')}"
            )

            print(error_text)

            skipped_count += 1

            errors.append(
                {
                    "firestore_id": doc.id,
                    "subject": email.get("subject"),
                    "error": error_text,
                }
            )

    return {
        "status": "ok",
        "processed": processed_count,
        "skipped": skipped_count,
        "errors": errors,
    }


@app.route("/ai-test", methods=["GET"])
def ai_test():

    try:

        docs = list(db.collection("emails").limit(1).stream())

        if not docs:
            return (
                jsonify({"status": "error", "error": "No emails found in Firestore"}),
                404,
            )

        doc = docs[0]
        email = doc.to_dict()

        analysis = analyze_email(email)

        return jsonify(
            {
                "status": "ok",
                "firestore_id": doc.id,
                "subject": email.get("subject"),
                "analysis": analysis,
            }
        )

    except Exception as e:

        return jsonify({"status": "error", "error": str(e)}), 500

def parse_flexible_date(value):

    if not value:
        return None

    try:
        parsed = date_parser.parse(value)
    except (ValueError, OverflowError, TypeError):
        return None

    if parsed.year < 2020 or parsed.year > 2035:
        return None

    return parsed


@app.route("/dashboard", methods=["GET"])
def dashboard():
    try:
        docs = list(
            db.collection("emails")
            .where("ai_processed", "==", True)
            .stream()
        )

        total_emails = len(docs)
        action_required_count = 0
        high_priority_count = 0

        category_counts = {
            "fees": 0,
            "uniform": 0,
            "event": 0,
            "academic": 0,
            "cafeteria": 0,
            "announcement": 0,
            "classroom": 0,
            "homework": 0,
            "other": 0,
        }

        emails = []

        for doc in docs:
            email = doc.to_dict()

            if( email.get("action_required") is True and email.get("action_status", "open") == "open"):
                action_required_count += 1

            if email.get("priority") == "high":
                high_priority_count += 1

            category = email.get("category", "other")

            if category not in category_counts:
                category = "other"

            category_counts[category] += 1

            emails.append({
                "firestore_id": doc.id,
                "subject": email.get("subject"),
                "summary": email.get("ai_summary"),
                "category": category,
                "priority": email.get("priority"),
                "action_required": email.get("action_required"),
                "deadline": email.get("deadline"),
                "action_status": email.get("action_status", "open"),
                "completed_at": email.get("completed_at"),
                "event_date": email.get("event_date"),
                "date": email.get("date"),
                "from": email.get("from"),
            })

        def parse_email_date(date_string):
            if not date_string:
                return datetime.min

            try:
                from email.utils import parsedate_to_datetime
                return parsedate_to_datetime(date_string)
            except Exception:
                return datetime.min

        emails.sort(
            key=lambda x: parse_email_date(x.get("date")),
            reverse=True
        )

        today = datetime.utcnow().date()
        upcoming_deadlines = []

        for email in emails:

            date_type = "deadline"
            target = parse_flexible_date(email.get("deadline"))

            if not target:
                date_type = "event"
                target = parse_flexible_date(email.get("event_date"))

            if not target:
                continue

            days_until = (target.date() - today).days

            if days_until < 0:
                continue

            upcoming_deadlines.append({
                "firestore_id": email.get("firestore_id"),
                "subject": email.get("subject"),
                "category": email.get("category"),
                "priority": email.get("priority"),
                "date_type": date_type,
                "target_date": target.strftime("%Y-%m-%d"),
                "target_date_display": target.strftime("%b %d, %Y"),
                "days_until": days_until,
            })

        upcoming_deadlines.sort(key=lambda x: x["target_date"])

        return jsonify({
            "status": "ok",
            "total_emails": total_emails,
            "action_required": action_required_count,
            "high_priority": high_priority_count,
            "categories": category_counts,
            "recent_emails": emails[:10],
            "upcoming_deadlines": upcoming_deadlines[:5],
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e),
        }), 500

# ==========================================================
# ROUTES
# ==========================================================


@app.route("/app", methods=["GET"])
def dashboard_page():
    return render_template("dashboard.html")

@app.route("/", methods=["GET"])
def health():

    return jsonify({"status": "ok", "message": "School Assistant is running"})


@app.route("/process", methods=["GET"])
def process_emails():

    try:

        result = process_school_emails()

        return jsonify(
            {
                "status": "ok",
                "gmail_account": result.get("gmail_account"),
                "label": LABEL_NAME,
                "found": result["found"],
                "new": result["new"],
                "existing": result["existing"],
            }
        )

    except Exception as e:

        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/process-ai", methods=["GET"])
def process_ai():

    try:

        result = process_ai_emails()

        if result.get("status") == "quota_exceeded":

            return jsonify(result), 429

        return jsonify(result)

    except Exception as e:

        return jsonify({"status": "error", "error": str(e)}), 500


# ==========================================================
# GET PROCESSED EMAILS
# ==========================================================

@app.route("/emails", methods=["GET"])
def get_emails():

    try:
        docs = (
            db.collection("emails")
            .where("ai_processed", "==", True)
            .stream()
        )

        emails = []

        for doc in docs:

            email = doc.to_dict()

            emails.append({
                "firestore_id": doc.id,
                "gmail_id": email.get("gmail_id"),
                "gmail_url": get_email_gmail_url(email),
                "subject": email.get("subject"),
                "from": email.get("from"),
                "date": email.get("date"),
                "category": email.get("category"),
                "summary": email.get("ai_summary"),
                "action_required": email.get("action_required"),
                "action_status": email.get("action_status", "open"),
                "completed_at": email.get("completed_at"),
                "priority": email.get("priority"),
                "deadline": email.get("deadline"),
                "event_date": email.get("event_date")
            })

        return jsonify({
            "status": "ok",
            "count": len(emails),
            "emails": emails
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500

@app.route("/emails/high-priority", methods=["GET"])
def get_high_priority_emails():

    try:
        docs = (
            db.collection("emails")
            .where("ai_processed", "==", True)
            .where("priority", "==", "high")
            .stream()
        )

        emails = []

        for doc in docs:

            email = doc.to_dict()

            emails.append({
                "firestore_id": doc.id,
                "subject": email.get("subject"),
                "from": email.get("from"),
                "date": email.get("date"),
                "category": email.get("category"),
                "summary": email.get("ai_summary"),
                "action_required": email.get("action_required"),
                "action_status": email.get("action_status", "open"),
                "completed_at": email.get("completed_at"),
                "priority": email.get("priority"),
                "deadline": email.get("deadline"),
                "event_date": email.get("event_date")
            })

        return jsonify({
            "status": "ok",
            "count": len(emails),
            "emails": emails
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500

@app.route("/emails/<email_id>", methods=["GET"])
def get_email(email_id):

    try:

        doc = (
            db.collection("emails")
            .document(email_id)
            .get()
        )

        if not doc.exists:

            return jsonify({
                "status": "error",
                "error": "Email not found"
            }), 404

        email = doc.to_dict()
        email["gmail_url"] = get_email_gmail_url(email)

        return jsonify({
            "status": "ok",
            "firestore_id": doc.id,
            "email": email
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500

@app.route("/emails/action-required", methods=["GET"])
def get_action_required_emails():

    try:
        docs = (
            db.collection("emails")
            .where("ai_processed", "==", True)
            .where("action_required", "==", True)
            .stream()
        )

        emails = []

        for doc in docs:

            email = doc.to_dict()

            # Existing emails without action_status are treated as open
            action_status = email.get("action_status", "open")

            # Only return unfinished actions
            if action_status != "open":
                continue

            emails.append({
                "firestore_id": doc.id,
                "gmail_id": email.get("gmail_id"),
                "gmail_url": get_email_gmail_url(email),
                "subject": email.get("subject"),
                "from": email.get("from"),
                "date": email.get("date"),
                "category": email.get("category"),
                "summary": email.get("ai_summary"),
                "action_required": True,
                "action_status": "open",
                "completed_at": None,
                "priority": email.get("priority"),
                "deadline": email.get("deadline"),
                "event_date": email.get("event_date")
            })

        return jsonify({
            "status": "ok",
            "count": len(emails),
            "emails": emails
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500
        
@app.route("/emails/<email_id>/complete", methods=["POST"])
def complete_email_action(email_id):

    try:

        doc_ref = db.collection("emails").document(email_id)
        doc = doc_ref.get()

        if not doc.exists:
            return jsonify({
                "status": "error",
                "error": "Email not found"
            }), 404

        completed_at = datetime.utcnow().isoformat() + "Z"

        doc_ref.update({
            "action_status": "completed",
            "completed_at": completed_at
        })

        return jsonify({
            "status": "ok",
            "message": "Action marked as completed",
            "firestore_id": email_id,
            "action_status": "completed",
            "completed_at": completed_at
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500
        
        
@app.route("/emails/<email_id>/reopen", methods=["POST"])
def reopen_email_action(email_id):

    try:

        doc_ref = db.collection("emails").document(email_id)
        doc = doc_ref.get()

        if not doc.exists:
            return jsonify({
                "status": "error",
                "error": "Email not found"
            }), 404

        doc_ref.update({
            "action_status": "open",
            "completed_at": None
        })

        return jsonify({
            "status": "ok",
            "message": "Action reopened",
            "firestore_id": email_id,
            "action_status": "open",
            "completed_at": None
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500       

# ==========================================================
# MAIN
# ==========================================================

if __name__ == "__main__":

    port = int(os.environ.get("PORT", 8080))

    app.run(host="0.0.0.0", port=port)
