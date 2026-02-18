FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src/ src/
COPY config/ config/
COPY skills/ skills/
EXPOSE 3000
CMD ["npm", "start"]
