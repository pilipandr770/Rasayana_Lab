FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js db.js membership_abi.json ./
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
