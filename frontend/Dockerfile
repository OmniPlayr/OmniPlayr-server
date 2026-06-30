FROM node:20 AS builder

WORKDIR /app

COPY package*.json .
RUN npm ci

COPY . .
RUN npm run build

FROM node:20

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g serve

COPY --from=builder /app/dist ./dist
COPY proxy.js /proxy.js

EXPOSE 8223

CMD ["sh", "-c", "node /proxy.js & serve -s dist -l 8222"]