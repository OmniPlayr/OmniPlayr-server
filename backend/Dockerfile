FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y build-essential libffi-dev python3-dev curl && \
    curl -fsSL https://get.docker.com | sh

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8224

CMD ["python", "main.py"]