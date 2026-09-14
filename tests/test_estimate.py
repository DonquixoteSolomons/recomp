"""The estimator: request shape, pause_turn handling, storage. Model is mocked."""
from __future__ import annotations

import io
import json
from types import SimpleNamespace as NS

import pytest
from PIL import Image

from recomp import db, estimate

RESULT = dict(
    dish="Chicken rice, extra chicken", items=[
        dict(name="Roasted chicken", portion="~180 g", protein_g=40, kcal=380, kcal_lo=330, kcal_hi=430, confidence="medium"),
        dict(name="Chicken rice", portion="1 plate ~250 g", protein_g=6, kcal=420, kcal_lo=380, kcal_hi=470, confidence="high"),
    ],
    protein_g=46, kcal=800, kcal_lo=710, kcal_hi=900, confidence="medium",
    assumptions=["standard hawker plate"], grounding=["HPB chicken rice ~650 kcal regular"],
    tighten="weight of the chicken",
)


class FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def _resp(stop="end_turn", text=None, content=None):
    usage = NS(input_tokens=1200, output_tokens=300, cache_read_input_tokens=0, cache_creation_input_tokens=900)
    blocks = content if content is not None else [NS(type="text", text=json.dumps(text or RESULT))]
    return NS(stop_reason=stop, content=blocks, usage=usage, stop_details=None)


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setattr(estimate, "PHOTO_DIR", tmp_path / "photos")
    return db.get_conn(tmp_path / "t.db")


def _jpeg(w=3000, h=2000) -> bytes:
    im = Image.new("RGB", (w, h), (200, 120, 60))
    b = io.BytesIO(); im.save(b, "JPEG"); return b.getvalue()


def test_prepare_image_downscales_and_reencodes():
    data, mt = estimate.prepare_image(_jpeg())
    assert mt == "image/jpeg"
    im = Image.open(io.BytesIO(data))
    assert max(im.size) == estimate.MAX_EDGE


def test_request_shape(conn, monkeypatch):
    fake = FakeMessages([_resp()])
    monkeypatch.setattr(estimate, "_client", lambda: NS(messages=fake))
    row = estimate.estimate(conn, [_jpeg()], "chicken rice extra chicken from 925", share_frac=1.0)

    req = fake.calls[0]
    assert req["model"] == "claude-opus-5"
    assert req["thinking"] == {"type": "adaptive"}
    assert req["output_config"]["format"]["type"] == "json_schema"
    assert req["tools"][0]["type"] == "web_search_20260209"
    assert req["system"][0]["cache_control"] == {"type": "ephemeral"}
    content = req["messages"][0]["content"]
    assert content[0]["type"] == "image" and content[0]["source"]["media_type"] == "image/jpeg"
    assert "925" in content[-1]["text"]

    assert row["result"]["protein_g"] == 46
    assert row["photos"] and (estimate.PHOTO_DIR / row["photos"][0]).exists()
    assert row["usage"]["input"] == 1200


def test_pause_turn_is_resumed_without_extra_user_message(conn, monkeypatch):
    paused = _resp(stop="pause_turn", content=[NS(type="server_tool_use", name="web_search")])
    fake = FakeMessages([paused, _resp()])
    monkeypatch.setattr(estimate, "_client", lambda: NS(messages=fake))
    estimate.estimate(conn, [], "bak kut teh from Song Fa")
    second = fake.calls[1]["messages"]
    assert [m["role"] for m in second] == ["user", "assistant"]


def test_refusal_raises(conn, monkeypatch):
    fake = FakeMessages([_resp(stop="refusal", content=[])])
    monkeypatch.setattr(estimate, "_client", lambda: NS(messages=fake))
    with pytest.raises(RuntimeError):
        estimate.estimate(conn, [], "x")


def test_refine_reattaches_photos_and_prior(conn, monkeypatch):
    fake = FakeMessages([_resp(), _resp(text={**RESULT, "protein_g": 30, "kcal": 500})])
    monkeypatch.setattr(estimate, "_client", lambda: NS(messages=fake))
    first = estimate.estimate(conn, [_jpeg()], "chicken rice")
    second = estimate.estimate(conn, [], "I only ate half the rice", parent_id=first["id"])
    content = fake.calls[1]["messages"][0]["content"]
    assert content[0]["type"] == "image"
    assert "Earlier estimate" in content[-1]["text"] and "half the rice" in content[-1]["text"]
    assert second["parent_id"] == first["id"] and second["result"]["kcal"] == 500


def test_share_fraction_is_stated(conn, monkeypatch):
    fake = FakeMessages([_resp()])
    monkeypatch.setattr(estimate, "_client", lambda: NS(messages=fake))
    estimate.estimate(conn, [], "mala", share_frac=0.25)
    assert "25%" in fake.calls[0]["messages"][0]["content"][-1]["text"]
