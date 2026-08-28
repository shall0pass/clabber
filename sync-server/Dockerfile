FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.mjs ./

ENV PORT=3030 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 3030

CMD ["node", "server.mjs"]
