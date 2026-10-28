from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.main import create_app
from app.models import Patient
from app.search import FUZZY_THRESHOLD, ensure_search_indexes, ranked_search


def create_patient(client, profile, **changes):
    response = client.post("/patients", json={**profile, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def search(client, value, **params):
    response = client.get("/patients", params={"search": value, **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_relevance_tiers_precede_column_sort_pagination_and_status(client, profile):
    exact = create_patient(client, profile, first_name="John", last_name="Smith", dob="1980-01-01")
    duplicate = create_patient(client, profile, first_name="JOHN", last_name="SMITH", dob="1990-01-01", status="inactive")
    prefix = create_patient(client, profile, first_name="John", last_name="Smithson", dob="1970-01-01")
    substring = create_patient(client, profile, first_name="Zelda", last_name="Zulu", conditions=["John Smith"], dob="1960-01-01")
    fuzzy = create_patient(client, profile, first_name="Jhon", last_name="Smith", dob="1950-01-01")
    create_patient(client, profile, first_name="Taylor", last_name="Jones", dob="1940-01-01")

    result = search(client, "  JOHN   smith ", sort_by="age", sort_order="desc")
    assert [item["id"] for item in result["items"]] == [exact["id"], duplicate["id"], prefix["id"], substring["id"], fuzzy["id"]]
    assert [item["search_match"]["kind"] for item in result["items"]] == ["exact_name", "exact_name", "name_prefix", "substring", "fuzzy"]
    assert result["items"][-1]["search_match"]["label"] == "Possible match"

    page = search(client, "John Smith", page=2, page_size=2, sort_by="age", sort_order="desc")
    assert page["total"] == 5 and page["total_pages"] == 3
    assert [item["id"] for item in page["items"]] == [prefix["id"], substring["id"]]
    filtered = search(client, "John Smith", status="inactive")
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == duplicate["id"]


def test_full_compact_and_short_ids_take_priority_and_collisions_are_visible(client, profile, db_engine):
    first = create_patient(client, profile, first_name="Avery")
    second = create_patient(client, profile, first_name="Jordan")
    ids = ["1234abcd-0000-4000-8000-000000000001", "1234abcd-0000-4000-8000-000000000002"]
    with Session(db_engine) as session:
        session.get(Patient, first["id"]).id = ids[0]
        session.get(Patient, second["id"]).id = ids[1]
        session.commit()
    other = create_patient(client, profile, first_name="Zelda", last_name="Alpha", conditions=[ids[0]])

    full = search(client, ids[0].upper())
    assert [item["id"] for item in full["items"]] == [ids[0], other["id"]]
    assert full["items"][0]["search_match"] == {"kind": "exact_id", "label": "Exact ID", "score": 1.0}
    assert search(client, UUID(ids[0]).hex)["items"][0]["id"] == ids[0]

    short = search(client, "1234ABCD")
    assert [item["id"] for item in short["items"]] == [*ids, other["id"]]
    assert [item["search_match"]["label"] for item in short["items"][:2]] == ["Exact short ID", "Exact short ID"]


def test_exact_contacts_normalize_case_and_phone_format_and_keep_duplicates(client, profile):
    first = create_patient(client, profile, first_name="Zelda", email="Shared@example.com", phone="+1 (202) 555-0123")
    second = create_patient(client, profile, first_name="Avery", email="shared@example.com", phone="1-202-555-0123")
    substring = create_patient(client, profile, first_name="Aaron", last_name="Alpha", email="other@example.com", conditions=["shared@example.com", "12025550123"])

    for query in ("SHARED@EXAMPLE.COM", "  +1 202 555 0123  ", "12025550123"):
        result = search(client, query)
        assert [item["id"] for item in result["items"][:2]] == [second["id"], first["id"]]
        assert [item["search_match"]["kind"] for item in result["items"][:2]] == ["exact_contact", "exact_contact"]
    email_result = search(client, "shared@example.com")
    assert email_result["items"][2]["id"] == substring["id"]
    assert email_result["items"][2]["search_match"]["kind"] == "substring"


def test_fuzzy_names_are_ranked_by_similarity_before_selected_sort(client, profile):
    closer = create_patient(client, profile, first_name="Harper", last_name="Zulu")
    farther = create_patient(client, profile, first_name="Harperton", last_name="Alpha")
    tied = create_patient(client, profile, first_name="Harperton", last_name="Beta")
    create_patient(client, profile, first_name="Morgan", last_name="Jones")
    result = search(client, "harpr")
    assert [item["id"] for item in result["items"]] == [closer["id"], farther["id"], tied["id"]]
    matches = [item["search_match"] for item in result["items"]]
    assert all(match["kind"] == "fuzzy" for match in matches)
    assert matches[0]["score"] == pytest.approx(4 / 9, abs=1e-6)
    assert matches[1]["score"] == pytest.approx(1 / 3, abs=1e-6)
    assert matches[1]["score"] == matches[2]["score"]
    assert all(FUZZY_THRESHOLD <= match["score"] <= 1 for match in matches)

    # A surname typo can find the same patient without an exact first name.
    assert search(client, "zulo")["items"][0]["id"] == closer["id"]
    assert search(client, "harpr", page=4, page_size=1)["items"] == []


def test_conservative_trigram_threshold_does_not_claim_all_short_transpositions(client, profile):
    patient = create_patient(client, profile, first_name="John", last_name="Smith")
    assert search(client, "Jhon")["total"] == 0
    result = search(client, "Jhon Smith")
    assert result["items"][0]["id"] == patient["id"]
    assert result["items"][0]["search_match"]["kind"] == "fuzzy"


@pytest.mark.parametrize("query", ["ha", "shraed@example.com", "12025550124", "%", "_", "\\"])
def test_fuzzy_never_expands_short_queries_contacts_or_sql_wildcards(client, profile, query):
    create_patient(client, profile, first_name="Harper", email="shared@example.com", phone="12025550123")
    result = search(client, query)
    assert all(item["search_match"]["kind"] != "fuzzy" for item in result["items"])
    if query != "ha":
        assert result["total"] == 0


@pytest.mark.parametrize("query", ["%", "_", "\\"])
def test_substring_wildcards_are_literal(client, profile, query):
    matched = create_patient(client, profile, conditions=[f"literal{query}value"])
    create_patient(client, profile, first_name="Jordan", conditions=["literal value"])
    result = search(client, query)
    assert [item["id"] for item in result["items"]] == [matched["id"]]
    assert result["items"][0]["search_match"]["kind"] == "substring"


def test_equal_relevance_and_sort_have_stable_id_ties_and_blank_search_has_no_metadata(client, profile):
    created = [create_patient(client, profile) for _ in range(3)]
    expected = sorted(item["id"] for item in created)
    for _ in range(2):
        pages = [search(client, "Avery Bennett", page=page, page_size=1) for page in (1, 2, 3)]
        assert [page["items"][0]["id"] for page in pages] == expected
    assert all(item["search_match"] is None for item in search(client, "   ")["items"])
    # Search explanations are list-only; read/write and dashboard contracts stay small.
    assert "search_match" not in client.get(f"/patients/{created[0]['id']}").json()
    assert "search_match" not in client.get("/dashboard").json()["recent_patients"][0]


def test_last_name_prefix_and_normalized_phone_substring_are_searchable(client, profile):
    patient = create_patient(client, profile, first_name="Avery", last_name="Bennett", phone="(202) 555-0199")
    assert search(client, "benn")["items"][0]["search_match"]["kind"] == "name_prefix"
    result = search(client, "5550199")
    assert result["items"][0]["id"] == patient["id"]
    assert result["items"][0]["search_match"]["kind"] == "substring"


def test_restart_preserves_records_and_search_index_setup_is_idempotent(client, profile, db_engine):
    patient = create_patient(client, profile)
    ensure_search_indexes(db_engine)
    ensure_search_indexes(db_engine)
    with TestClient(create_app(db_engine, seed_enabled=False)) as restarted:
        assert search(restarted, "avery")["items"][0]["id"] == patient["id"]

    if db_engine.dialect.name == "postgresql":
        schema = db_engine.get_execution_options()["schema_translate_map"][None]
        with db_engine.connect() as connection:
            indexes = connection.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname = :schema AND tablename = 'patients' AND indexname LIKE 'ix_patients_search_%'"), {"schema": schema}).scalars().all()
            assert len(indexes) == 11
            assert connection.execute(text("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'")).scalar_one() == "public"
            # With sequential scans disabled, the real candidate predicate can
            # use the expression indexes, rather than scoring every patient.
            connection.execute(text("SET LOCAL enable_seqscan = off"))
            connection.execute(text("SELECT set_config('pg_trgm.similarity_threshold', :threshold, true)"), {"threshold": str(FUZZY_THRESHOLD)})
            statement = select(Patient.id).where(ranked_search("harpr", "postgresql").predicate)
            sql = str(statement.compile(dialect=db_engine.dialect, compile_kwargs={"literal_binds": True}, schema_translate_map={None: schema}, render_schema_translate=True))
            plan = connection.exec_driver_sql("EXPLAIN " + sql).scalars().all()
            assert "ix_patients_search_" in "\n".join(plan)
