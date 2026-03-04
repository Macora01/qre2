FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY frontend/ ./
ENV REACT_APP_BACKEND_URL=""
RUN yarn build

FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY --from=frontend-builder /app/frontend/build /app/frontend/build
RUN mkdir -p /app/data
EXPOSE 8001
ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8001"]
