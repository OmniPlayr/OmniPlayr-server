FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json .
RUN npm ci

COPY . .

RUN IP=$(ip route | awk 'NR==1 {print $3}') && \
    sed -i "s|http://localhost:8224|http://$IP:8224|g; s|ws://localhost:8224|ws://$IP:8224|g" src/config/api.toml

RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 8223

CMD ["serve", "-s", "dist", "-l", "8223"]