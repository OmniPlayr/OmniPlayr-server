FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .

RUN apt-get update && \
    apt-get install -y build-essential libffi-dev python3-dev && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8224

CMD ["python", "main.py"]