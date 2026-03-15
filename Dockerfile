FROM node:20-alpine

WORKDIR /app

COPY node_app/package*.json ./node_app/
RUN cd node_app && npm ci --omit=dev

COPY node_app ./node_app
COPY Tabulacion.xlsx ./Tabulacion.xlsx

ENV PORT=8080
ENV CORS_ORIGIN=*
ENV TEMPLATE_PATH=/app/Tabulacion.xlsx
ENV RESULT_TTL_SECONDS=900
ENV AUTH_REQUIRED=true
ENV AUTH_TOKEN_SECRET=change-this-token-secret
ENV AUTH_TOKEN_TTL_SECONDS=86400
ENV USER_STORE_PATH=/app/node_app/data/users.json
ENV ADMIN_EMAIL=admin@tabulacion.local
ENV ADMIN_PASSWORD=Admin12345!

EXPOSE 8080

CMD ["node", "node_app/server.js"]
