FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y curl ca-certificates gnupg && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

RUN npm install -g @omniplayr/cli

RUN apt-get update && \
    apt-get install -y build-essential libffi-dev python3-dev docker.io && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8224

CMD ["python", "main.py"]