"""XGBoost inference sidecar for JuniperFin.

Single endpoint: POST /predict — takes a batch of feature rows, returns the
sklearn predict_proba(class=1) for each, scaled to a 0..100 ml_score.

The model was trained by the original Python project (train_model.py). It is
a pickled dict {"model": XGBClassifier, "meta": {...}}. Feature order must
match FEATURE_COLS exactly — the Node client is responsible for ordering.
"""

from __future__ import annotations

import logging
import os
import pickle
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger("xgb")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Must match Python train_model.py / ml.py FEATURE_COLS order exactly.
FEATURE_COLS = [
    "ret_21d", "ret_63d", "ret_126d", "ret_prev_21d", "accel",
    "trend_slope", "dist_sma50", "dist_sma200", "breakout",
    "realized_vol_ann", "beta", "max_drawdown_60d",
    "rel_volume", "spread_bps",
    "revenue_growth", "earnings_growth", "profit_margin", "roe",
    "debt_to_equity", "forward_pe",
]

MODEL_PATH = Path(os.environ.get("XGB_MODEL_PATH", "/models/xgb_model.pkl"))

_model = None
_meta: dict = {}
_loaded_at: Optional[float] = None


def _load_model() -> bool:
    """Lazy-load model from disk. Returns True if loaded."""
    global _model, _meta, _loaded_at
    if _model is not None:
        return True
    if not MODEL_PATH.is_file():
        log.warning("model not found at %s", MODEL_PATH)
        return False
    try:
        with MODEL_PATH.open("rb") as f:
            data = pickle.load(f)
        _model = data["model"]
        _meta = data.get("meta", {})
        _loaded_at = time.time()
        log.info(
            "model loaded: %d features, %d samples, %.1f%% pos rate, holding=%sd, threshold=%s%%",
            len(_meta.get("features", FEATURE_COLS)),
            _meta.get("samples", 0),
            _meta.get("pos_rate", 0) * 100,
            _meta.get("holding_days"),
            _meta.get("threshold_pct"),
        )
        return True
    except Exception as e:
        log.exception("model load failed: %s", e)
        return False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _load_model()  # warm at boot; not fatal if missing
    yield


app = FastAPI(title="singscanner-xgb", lifespan=lifespan)


class FeatureRow(BaseModel):
    # symbol is opaque to the model; passed through so the caller can map results
    symbol: str
    features: dict[str, Optional[float]] = Field(default_factory=dict)


class PredictRequest(BaseModel):
    rows: list[FeatureRow]


class PredictResult(BaseModel):
    symbol: str
    p_up: float       # 0..1, P(class=1)
    ml_score: float   # 0..100, p_up * 100


class PredictResponse(BaseModel):
    loaded: bool
    rows: list[PredictResult]
    skipped: list[str] = []  # symbols dropped (missing critical features)


@app.get("/health")
def health() -> dict:
    loaded = _model is not None
    return {
        "ok": True,
        "model_loaded": loaded,
        "model_path": str(MODEL_PATH),
        "loaded_at": _loaded_at,
        "meta": _meta if loaded else None,
    }


def _row_to_array(features: dict[str, Optional[float]]) -> np.ndarray:
    """Map a dict to the canonical FEATURE_COLS order. Missing values -> NaN
    (XGBoost handles NaNs natively as a learned split)."""
    return np.array(
        [features.get(col) if features.get(col) is not None else np.nan for col in FEATURE_COLS],
        dtype=np.float32,
    )


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if _model is None and not _load_model():
        # Return empty results rather than 500 — caller already has a mock fallback.
        return PredictResponse(loaded=False, rows=[], skipped=[r.symbol for r in req.rows])

    syms: list[str] = []
    X: list[np.ndarray] = []
    skipped: list[str] = []
    for row in req.rows:
        # We require at least price-derived returns to be present; otherwise it's
        # mostly garbage features and the model output is meaningless. Match
        # ml.py's predict_xgb which silently drops symbols without price.
        if row.features.get("ret_21d") is None and row.features.get("ret_63d") is None:
            skipped.append(row.symbol)
            continue
        X.append(_row_to_array(row.features))
        syms.append(row.symbol)

    if not X:
        return PredictResponse(loaded=True, rows=[], skipped=skipped)

    Xa = np.vstack(X)
    try:
        probs = _model.predict_proba(Xa)[:, 1]
    except Exception as e:
        log.exception("predict failed: %s", e)
        raise HTTPException(status_code=500, detail=f"predict failed: {e}")

    return PredictResponse(
        loaded=True,
        rows=[
            PredictResult(symbol=s, p_up=float(p), ml_score=float(p * 100))
            for s, p in zip(syms, probs)
        ],
        skipped=skipped,
    )
