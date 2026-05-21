FROM node:22-alpine

RUN apk add --no-cache docker-cli bash sudo

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "start"]
