#!/usr/bin/env python3
"""Exercise an explicitly selected demo stack without third-party dependencies.

The API URL may point at the frontend's /api proxy, which verifies the complete
browser-to-database path. Only the disposable patient created here is modified.
"""

import argparse
import json
import math
import sys
import time
from datetime import date, datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4


def explicit_http_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise argparse.ArgumentTypeError("Supply an explicit http:// or https:// URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise argparse.ArgumentTypeError("URLs must not contain credentials, query parameters, or fragments")
    return value.rstrip("/")


def request(url: str, method: str = "GET", payload=None, expected: int = 200, accept: str = "application/json"):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": accept, "User-Agent": "ascertain-smoke-test/1.0"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    outgoing = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(outgoing, timeout=15) as response:
            status_code = response.status
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
    except HTTPError as error:
        status_code = error.code
        body = error.read()
        content_type = error.headers.get("Content-Type", "")
    if status_code != expected:
        raise AssertionError(f"{method} {url}: expected HTTP {expected}, received {status_code}; {body.decode('utf-8', errors='replace')[:500]}")
    if "application/json" in content_type and body:
        return json.loads(body)
    return body


def wait_for_health(api_base: str):
    deadline = time.monotonic() + 60
    while True:
        try:
            assert request(f"{api_base}/health") == {"status": "ok"}
            return
        except (AssertionError, URLError, TimeoutError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)


def parsed_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def verify_html(url: str):
    html = request(url, accept="text/html")
    assert isinstance(html, bytes) and b"<html" in html.lower(), f"Expected SPA HTML at {url}"
    assert b'id="root"' in html or b"id='root'" in html, f"Missing React root at {url}"


def smoke_test(api_base: str, frontend_url: str):
    wait_for_health(api_base)
    first = request(f"{api_base}/patients?page=1&page_size=7")
    second = request(f"{api_base}/patients?page=2&page_size=7")
    assert first["total"] >= 120, "Expected at least 120 seeded fictional patients"
    assert first["page"] == 1 and first["page_size"] == 7
    assert first["total_pages"] == math.ceil(first["total"] / 7)
    assert len(first["items"]) == 7 and len(second["items"]) == 7
    assert {item["id"] for item in first["items"]}.isdisjoint(item["id"] for item in second["items"])
    print("Health, seed data, and pagination verified.")

    patient_id = None
    primary_error = False
    unique = uuid4().hex[:12]
    profile = {
        "first_name": "Smoke",
        "last_name": f"Check-{unique}",
        "dob": "1990-06-15",
        "status": "active",
        "email": f"smoke.{unique}@example.com",
        "last_visit": date.today().isoformat(),
        "allergies": [],
        "conditions": [],
    }
    try:
        created = request(f"{api_base}/patients", method="POST", payload=profile, expected=201)
        patient_id = created["id"]
        patient_url = f"{api_base}/patients/{patient_id}"
        assert request(patient_url)["email"] == profile["email"]

        edited_profile = {**profile, "first_name": "Smoke Edited", "status": "follow_up", "conditions": ["Synthetic smoke test condition"]}
        edited = request(patient_url, method="PUT", payload=edited_profile)
        persisted = request(patient_url)
        assert edited["id"] == patient_id and persisted["id"] == patient_id
        assert persisted["first_name"] == "Smoke Edited"
        assert persisted["status"] == "follow_up" and persisted["conditions"] == edited_profile["conditions"]
        print("Patient creation, editing, and persistence across requests verified.")

        timestamp = datetime.now(timezone.utc) - timedelta(seconds=1)
        content = f"Disposable smoke check {unique}: patient contact details confirmed."
        note = request(f"{patient_url}/notes", method="POST", payload={"timestamp": timestamp.isoformat(), "content": content}, expected=201)
        assert note["patient_id"] == patient_id and note["content"] == content
        assert abs((parsed_timestamp(note["timestamp"]) - timestamp).total_seconds()) < 1
        notes = request(f"{patient_url}/notes")
        assert len(notes) == 1 and notes[0]["id"] == note["id"] and notes[0]["content"] == content

        summary = request(f"{patient_url}/summary")
        assert summary["patient_id"] == patient_id and summary["generated_at"]
        assert content in summary["summary"] and "Smoke Edited" in summary["summary"]
        request(f"{patient_url}/notes/{note['id']}", method="DELETE", expected=204)
        assert request(f"{patient_url}/notes") == []
        assert content not in request(f"{patient_url}/summary")["summary"]
        print("Timestamped notes, current summaries, and scoped note deletion verified.")

        verify_html(frontend_url)
        verify_html(f"{frontend_url}/patients/{patient_id}")
        print("Frontend root and patient detail SPA routing verified.")
    except BaseException:
        primary_error = True
        raise
    finally:
        if patient_id is not None:
            try:
                patient_url = f"{api_base}/patients/{patient_id}"
                request(patient_url, method="DELETE", expected=204)
                request(patient_url, expected=404)
                print("Disposable patient and its data deleted.")
            except Exception as cleanup_error:
                print(f"Cleanup failed for disposable patient {patient_id}: {cleanup_error}", file=sys.stderr)
                if not primary_error:
                    raise
    print("Full stack smoke test passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True, type=explicit_http_url, help="Explicit API base URL, including /api when using the frontend proxy")
    parser.add_argument("--frontend-url", required=True, type=explicit_http_url, help="Explicit frontend URL")
    arguments = parser.parse_args()
    smoke_test(arguments.api_base, arguments.frontend_url)


if __name__ == "__main__":
    main()
