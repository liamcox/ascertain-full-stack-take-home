FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 appuser

COPY --chown=appuser:appuser app ./app
COPY --chown=appuser:appuser alembic.ini ./
COPY --chown=appuser:appuser alembic ./alembic
USER appuser

EXPOSE 8000
CMD ["sh", "-c", "python -m app.migrations upgrade && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
