import httpx
import pytest

from scripts._backend_import import BackendImporter

BASE = "http://backend.test/api"


def _importer():
    return BackendImporter(BASE, "tok", job_timeout_seconds=5,
                           upload_timeout_seconds=5, job_poll_seconds=0)


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_find_or_create_word_reuses_the_id_from_a_409():
    def handler(req):
        assert req.headers["Authorization"] == "Bearer tok"
        return httpx.Response(409, json={"word_id": 42})
    with _client(handler) as c:
        assert _importer().find_or_create_word(c, {"label": "HELLO"}) == 42


def test_stored_per_signer_counts_each_session():
    rows = [{"session_id": "s1"}, {"session_id": "s1"}, {"session_id": "s2"}]
    with _client(lambda req: httpx.Response(200, json={"samples": rows})) as c:
        assert _importer().stored_per_signer(c, 7) == {"s1": 2, "s2": 1}


def test_wait_for_job_survives_a_dropped_poll_then_returns_the_final_row():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("dropped")
        if calls["n"] == 2:
            return httpx.Response(200, json={"job": {"status": "processing"}})
        return httpx.Response(200, json={"job": {"status": "completed", "id": 9}})

    with _client(handler) as c:
        assert _importer().wait_for_job(c, 9, "HELLO", "s1")["status"] == "completed"


def test_upload_batch_sends_one_request_with_the_signer_and_waits(tmp_path):
    clip = tmp_path / "a.mov"
    clip.write_bytes(b"x")
    seen = []

    def handler(req):
        seen.append((req.method, req.url.path))
        if req.url.path.endswith("/upload-jobs/active"):
            return httpx.Response(200, json={"job": None})
        if req.url.path.endswith("/upload-videos"):
            assert b'name="session_id"' in req.content and b"s1" in req.content
            return httpx.Response(202, json={"job": {"id": 3}})
        return httpx.Response(200, json={"job": {"status": "completed", "id": 3}})

    with _client(handler) as c:
        result = _importer().upload_batch(c, 7, "HELLO", "s1", [str(clip)])
    assert result["status"] == "completed"
    assert [m for m, _ in seen].count("POST") == 1


def test_upload_batch_refuses_more_than_the_server_cap(tmp_path):
    with _client(lambda req: httpx.Response(200, json={"job": None})) as c:
        with pytest.raises(SystemExit):
            _importer().upload_batch(c, 7, "HELLO", "s1", ["x"] * 51)
