# MCP Document Service

> 🚀 基于 Pandoc 的高质量 MCP 文档转换服务

📖 **[查看完整部署指南 COMPLETE-GUIDE.md](doc/COMPLETE-GUIDE.md)** - 一站式部署与集成文档

---

## ✨ 核心特性

- 📝 **专业文档转换**: 基于 Pandoc 的高质量 Markdown 到 Word 转换
- 🌐 **多协议支持**: MCP、REST API、SSE 实时通信
- 📋 **完整API文档**: OpenAPI 3.0 规范 + Swagger UI
- 🛠️ **工具集成**: 完美支持 OpenWebUI 等第三方平台
- 🐳 **容器化部署**: Docker 和 Docker Compose 支持
- 🔗 **智能文件管理**: 临时下载链接，30分钟自动清理

---

## 🚀 快速开始指南

### 方法一：直接运行

```bash
npm install    # 安装依赖
npm start      # 启动服务
```

### 方法二：Docker 部署（推荐）

```bash
# 构建镜像
docker build -t mcp-document-service:latest .

# 运行容器（使用默认配置）
docker run -d -p 3002:3000 chengmq/mcp-document-service:latest

# 运行容器（自定义环境变量）
docker run -d -p 3002:3000 \
  -e PROTOCOL=https \
  -e HOST=myserver.com \
  -e PORT=3000 \
  -e BASEPATH=/api/docs \
  -e PROXY_URL=http://localhost:3000 \
  -e FILE_EXPIRY_MINUTES=60 \
  mcp-document-service:latest

# 或使用 Docker Compose
docker-compose up -d

# Docker Compose 自定义环境变量
PROTOCOL=https HOST=myserver.com PORT=3000 docker-compose up -d

# 或创建 production.env 文件并修改 docker-compose.yml
cp production.env.example production.env
# 编辑 production.env，然后取消注释 docker-compose.yml 中的相关行
docker-compose up -d
```

#### 🔧 环境变量配置

| 变量名 | 默认值 | 描述 |
|--------|--------|------|
| `PROTOCOL` | `http` | 协议类型 (http/https) |
| `HOST` | `localhost` | 服务器主机名 |
| `PORT` | `3000` | 服务端口 |
| `BASEPATH` | `/md-to-doc` | API基础路径 |
| `FILE_EXPIRY_MINUTES` | `30` | 文件过期时间（分钟） |
| `CLEANUP_INTERVAL_MINUTES` | `5` | 清理间隔（分钟） |

**环境变量优先级**：`-e` 参数 > `--env-file` > `.env` 文件

### 验证服务

```bash
# 健康检查
curl http://localhost:3000/md-to-word/health

# API 文档: http://localhost:3000/md-to-word/docs
```

---

## 📚 完整文档

| 文档 | 描述 |
|------|------|
| **[COMPLETE-GUIDE.md](doc/COMPLETE-GUIDE.md)** | 🎯 完整部署指南（包含详细构建命令） |
| **[ENVIRONMENT-VARIABLES.md](doc/ENVIRONMENT-VARIABLES.md)** | 🔧 环境变量配置详细说明 |

---

## 📊 项目报告

### 🎯 改造目标

将基于 Express 的 MCP 文档服务改造为同时支持 SSE (Server-Sent Events) 和 HTTP 两种端点，并集成 @modelcontextprotocol/sdk。

### ✅ 完成情况

#### 1. 核心功能实现

- ✅ **MCP SDK 集成**: 成功集成 `@modelcontextprotocol/sdk`

- ✅ **双端点架构**: SSE 端点 (`/md-to-word/sse`) 和 HTTP 端点 (`/md-to-word/mcp`)

- ✅ **实时通信**: Server-Sent Events 支持

- ✅ **向后兼容**: 保持 JSON-RPC 2.0 兼容性

- ✅ **错误处理**: 完善的错误处理机制

- ✅ **文档转换**: Markdown 转 Word 功能

#### 2. 技术架构

```text
┌──────────────┐
│   客户端        │
└──────┬───────┘
       │
       ├── SSE 连接 (/md-to-word/sse)
       │   └── EventSource → SSEServerTransport → MCP Server
       │
       └── HTTP 请求 (/md-to-word/mcp) 
           └── JSON-RPC 2.0 → Express 处理器 → 工具函数
```

#### 3. 端点说明

##### SSE 端点 (`/md-to-word/sse`)

- **用途**: 实时双向通信

- **协议**: Server-Sent Events + MCP Protocol

- **特点**: 支持流式响应，适合长时间任务

- **连接**: `new EventSource('http://localhost:3000/md-to-word/sse')`

##### HTTP 端点 (`/md-to-word/mcp`)

- **用途**: 传统请求-响应模式  

- **协议**: JSON-RPC 2.0 over HTTP

- **特点**: 简单集成，向后兼容

- **使用**: 标准 HTTP POST 请求

#### 4. 支持的 MCP 方法

| 方法 | 描述 | 端点支持 |
|------|------|----------|
| `initialize` | 初始化 MCP 连接 | SSE + HTTP |
| `tools/list` | 获取工具列表 | SSE + HTTP |  
| `tools/call` | 调用工具执行任务 | SSE + HTTP |

---

## 🔗 OpenWebUI 集成指南

本文档介绍如何将MCP文档服务集成到OpenWebUI中作为外部工具使用。

### 🚀 快速开始

#### 1. 启动服务

```bash
cd d:\WorkSpace\ai\mcp-document-service
node index.js
```

#### 2. 在OpenWebUI中配置工具

##### 方法A: 使用OpenAPI规范自动配置

1. 打开OpenWebUI管理界面

2. 导航到 "Settings" > "Tools"

3. 点击 "Add Tool" 或 "Import Tool"

4. 输入OpenAPI规范URL: `http://localhost:3000/md-to-word/openapi.json`

5. 系统会自动解析并导入所有可用工具

##### 方法B: 手动配置单个工具

```json
{
  "name": "markdown_to_word",
  "description": "将Markdown文本转换为Word文档",
  "endpoint": "http://localhost:3000/md-to-word/tools/markdown_to_word",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "parameters": {
    "name": {
      "type": "string",
      "description": "文档名称",
      "required": true
    },
    "content": {
      "type": "string", 
      "description": "Markdown内容",
      "required": true
    }
  }
}
```

### 📋 可用端点

#### 1. OpenAPI 规范端点

- **URL**: `GET http://localhost:3000/md-to-word/openapi.json`

- **用途**: 获取完整的OpenAPI 3.0规范

---

## 🧪 测试报告


---

感谢使用 MCP Document Service！
