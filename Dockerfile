# 使用官方Node.js运行时作为基础镜像
FROM node:22-slim
# 设置工作目录
WORKDIR /app

# 安装系统依赖和Pandoc
RUN apt-get update && apt-get install -y \
    pandoc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制package.json和package-lock.json
COPY package*.json /app/

COPY . /app/


# 安装项目依赖
RUN npm ci --only=production


# 创建必要的目录
RUN mkdir -p downloads temp

# 设置环境变量
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 启动应用
CMD ["node", "index.js"]
