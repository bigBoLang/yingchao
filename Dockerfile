# 构建阶段：装全量依赖并编译前端、服务端
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 优先用预编译包，缺失时回退到源码编译
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# 运行阶段：只保留运行所需文件
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/.env.example ./.env.example
VOLUME /app/data
EXPOSE 8787
CMD ["node", "-r", "dotenv/config", "dist-server/index.js"]
