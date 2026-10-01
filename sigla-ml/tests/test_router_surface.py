"""
The ML service's HTTP surface is exactly what the Node backend calls.

Read with ast rather than importing app.main: importing pulls in TensorFlow and
requires Supabase credentials, which this check does not need.
"""
import ast
import pathlib

ROUTER = pathlib.Path(__file__).resolve().parents[1] / "app" / "routers" / "model.py"


def _routes() -> set[str]:
    tree = ast.parse(ROUTER.read_text(encoding="utf-8"))
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if (
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and isinstance(dec.func.value, ast.Name)
                and dec.func.value.id == "router"
            ):
                found.add(f"{dec.func.attr.upper()} {dec.args[0].value}")
    return found


def test_router_exposes_only_what_the_backend_calls():
    # modelController: /train, /training/{id}/progress, /test.
    # wordController.extractAndStoreSample: /extract-landmarks.
    assert _routes() == {
        "GET /training/{model_id}/progress",
        "POST /train",
        "POST /test",
        "POST /extract-landmarks",
    }
