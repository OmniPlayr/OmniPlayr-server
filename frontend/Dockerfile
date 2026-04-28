FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json .
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist
COPY config/api.toml ./config/api.toml

EXPOSE 8223

CMD sh -c "IP=$(hostname -i | awk '{print $1}') && sed -i \"s|http://localhost:8224|http://$IP:8224|g; s|ws://localhost:8224|ws://$IP:8224|g\" config/api.toml && serve -s dist -l 8223"