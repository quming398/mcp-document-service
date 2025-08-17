# 🔧 环境变量配置指南

## 📋 支持的环境变量

| 变量名 | 默认值 | 描述 | 示例 |
|--------|--------|------|------|
| `PROTOCOL` | `http` | 协议类型 | `https` |
| `HOST` | `localhost` | 服务器主机名 | `myserver.com` |
| `PORT` | `3000` | 服务端口 | `3000` |
| `BASEPATH` | `/md-to-doc` | API基础路径 | `/api/docs` |
| `FILE_EXPIRY_MINUTES` | `30` | 文件过期时间（分钟） | `60` |
| `CLEANUP_INTERVAL_MINUTES` | `5` | 清理间隔（分钟） | `10` |

## 🐳 Docker 环境变量配置

### 方法一：命令行 `-e` 参数

```bash
docker run -d -p 3002:3000 \
  -e PROTOCOL=https \
  -e HOST=myserver.com \
  -e PORT=3000 \
  -e BASEPATH=/api/docs \
  -e FILE_EXPIRY_MINUTES=60 \
  mcp-document-service:latest
```

### 方法二：使用环境文件

1. 创建自定义环境文件：
```bash
cp production.env.example production.env
```

2. 编辑 `production.env`：
```env
PROTOCOL=https
HOST=myserver.com
PORT=3000
BASEPATH=/api/docs
FILE_EXPIRY_MINUTES=60
```

3. 使用环境文件启动：
```bash
docker run -d -p 3002:3000 \
  --env-file production.env \
  mcp-document-service:latest
```

### 方法三：Docker Compose

1. 直接在命令行设置：
```bash
PROTOCOL=https HOST=myserver.com PORT=3000 docker-compose up -d
```

2. 或创建 `.env` 文件在项目根目录：
```env
PROTOCOL=https
HOST=myserver.com
PORT=3000
BASEPATH=/api/docs
FILE_EXPIRY_MINUTES=60
```

3. 然后启动：
```bash
docker-compose up -d
```

## 📊 环境变量优先级

从高到低：
1. **命令行 `-e` 参数** - 最高优先级
2. **Docker Compose environment** - 中等优先级  
3. **--env-file 参数** - 较低优先级
4. **项目 .env 文件** - 最低优先级

## 🔍 验证环境变量

启动容器后可以通过以下方式验证：

```bash
# 查看容器环境变量
docker exec <container-id> env | grep -E "(PROTOCOL|HOST|PORT|BASEPATH)"

# 检查服务健康状态
curl http://your-host:your-port/your-basepath/health
```

## 🚀 生产环境推荐配置

```bash
docker run -d \
  --name mcp-document-service \
  --restart unless-stopped \
  -p 80:3000 \
  -e PROTOCOL=https \
  -e HOST=your-domain.com \
  -e PORT=3000 \
  -e BASEPATH=/api/mcp-docs \
  -e FILE_EXPIRY_MINUTES=60 \
  -e CLEANUP_INTERVAL_MINUTES=10 \
  -v $(pwd)/downloads:/app/downloads \
  mcp-document-service:latest
```

这样配置后，服务将在 `https://your-domain.com/api/mcp-docs` 路径下可用。
