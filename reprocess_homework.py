"""
One-off: re-run the AI classifier over already-processed emails with the
updated prompt, so homework hidden inside classroom/academic emails (and not
literally called "homework") gets picked up and tagged with a school_subject.
"""

import time

from app import db, analyze_email


docs = list(
    db.collection("emails")
    .where("ai_processed", "==", True)
    .stream()
)

print(f"Found {len(docs)} processed emails.")

updated_count = 0
recategorized_count = 0
error_count = 0

for doc in docs:

    email = doc.to_dict()
    old_category = email.get("category")

    try:

        analysis = analyze_email(email)

        new_category = analysis.get("category", "other")

        db.collection("emails").document(doc.id).update(
            {
                "category": new_category,
                "school_subject": analysis.get("school_subject"),
                "ai_summary": analysis.get("ai_summary"),
                "action_required": analysis.get("action_required"),
                "priority": analysis.get("priority"),
                "deadline": analysis.get("deadline"),
                "event_date": analysis.get("event_date"),
            }
        )

        updated_count += 1

        if new_category != old_category:
            recategorized_count += 1
            print(
                f"{old_category} -> {new_category} "
                f"({analysis.get('school_subject')}): {email.get('subject', '')}"
            )

    except Exception as e:

        error_count += 1
        print(f"FAILED: {email.get('subject', '')} - {e}")

    time.sleep(1.5)

print()
print(
    f"Done. Updated {updated_count}, recategorized {recategorized_count}, "
    f"errors {error_count}."
)
