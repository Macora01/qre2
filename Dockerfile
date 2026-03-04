# Multi-stage Dockerfile for Coolify deployment
# Stage 1: Build React frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy frontend source
COPY frontend/ ./

# Build frontend for production
RUN yarn build

# Stage 2: Python backend with built frontend
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements FIRST (for better caching)
COPY backend/requirements.txt /app/backend/requirements.txt

# Upgrade pip and install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend code
COPY backend/ /app/backend/

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/build /app/frontend/build

# Create data directory for CSV files
RUN mkdir -p /app/data

# Expose port
EXPOSE 8001

# Environment variables (will be overridden by Coolify/docker-compose)
ENV PYTHONUNBUFFERED=1
ENV MONGO_URL=mongodb://localhost:27017
ENV DB_NAME=qre_production
ENV CORS_ORIGINS=*

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8001/api/ || exit 1

# Start backend server (FastAPI will serve both API and frontend)
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8001"]

