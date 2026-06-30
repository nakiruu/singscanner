# XGBoost inference sidecar.
# Slim Python 3.12 + the four scientific deps required to unpickle and run
# the sklearn XGBClassifier produced by train_model.py.

FROM python:3.12-slim AS base

WORKDIR /srv

# Build essentials for any wheels that fall back to source on this arch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV XGB_MODEL_PATH=/models/xgb_model.pkl
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
