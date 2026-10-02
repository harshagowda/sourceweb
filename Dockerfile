# SourceWeb in a container — works the same on Linux, macOS and Windows (Docker Desktop).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep universal-ctags nodejs npm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN cd web/vendor && npm install --no-audit --no-fund prettier@3 >/dev/null 2>&1 || true
ENV SW_WORKSPACE=/projects SW_DATA=/data SW_HOST=0.0.0.0 SW_PORT=2727
RUN git config --system --add safe.directory '*'
VOLUME ["/projects", "/data"]
EXPOSE 2727
CMD ["python", "-m", "server.app"]
