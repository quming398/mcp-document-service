# OpenWebUI 工具集成指南

本文档介绍如何将MCP文档服务集成到OpenWebUI中作为外部工具使用。

## 🚀 快速开始

### 1. 启动服务
```bash
cd d:\WorkSpace\ai\mcp-document-service
node index.js
```

### 2. 在OpenWebUI中配置工具

#### 方法A: 使用OpenAPI规范自动配置
1. 打开OpenWebUI管理界面
2. 导航到 "Settings" > "Tools"
3. 点击 "Add Tool" 或 "Import Tool"
4. 输入OpenAPI规范URL: `http://localhost:3000/openapi.json`
5. 系统会自动解析并导入所有可用工具

#### 方法B: 手动配置单个工具
```json
{
  "name": "markdown_to_word",
  "description": "将Markdown文本转换为Word文档",
  "endpoint": "http://localhost:3000/tools/markdown_to_word",
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

## 📋 可用端点

### 1. OpenAPI 规范端点
- **URL**: `GET http://localhost:3000/openapi.json`
- **用途**: 获取完整的OpenAPI 3.0规范
- **响应**: JSON格式的API规范

### 2. Swagger UI 文档
- **URL**: `GET http://localhost:3000/docs`  
- **用途**: 交互式API文档界面
- **响应**: HTML文档页面

### 3. 简化工具端点
- **URL**: `POST http://localhost:3000/tools/markdown_to_word`
- **用途**: 直接调用Markdown转Word工具
- **参数**: 
  ```json
  {
    "name": "文档名称",
    "content": "# 标题\n\n**粗体**内容"
  }
  ```

### 4. MCP 协议端点（高级用户）
- **URL**: `POST http://localhost:3000/mcp`
- **协议**: JSON-RPC 2.0
- **支持格式**: JSON 和 SSE

## 🔧 工具配置示例

### 在OpenWebUI中的配置

```yaml
# 工具配置文件
tools:
  - name: "markdown_to_word"
    description: "将Markdown转换为Word文档"
    endpoint: "http://localhost:3000/tools/markdown_to_word"
    method: "POST"
    content_type: "application/json"
    parameters:
      name:
        type: string
        description: "文档名称"
        required: true
      content:
        type: string
        description: "Markdown内容"
        required: true
    response_format: "json"
    success_field: "success"
    download_url_field: "downloadUrl"
```

## 🌐 使用示例

### cURL 调用示例
```bash
# 获取OpenAPI规范
curl -X GET http://localhost:3000/openapi.json

# 调用转换工具
curl -X POST http://localhost:3000/tools/markdown_to_word \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试文档",
    "content": "# 标题\n\n这是**测试**内容。"
  }'

# 下载文档
curl -X GET http://localhost:3000/download/{fileId} -o document.docx
```

### JavaScript 调用示例
```javascript
// 调用转换工具
const response = await fetch('http://localhost:3000/tools/markdown_to_word', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: '我的文档',
    content: '# 标题\n\n这是 **测试** 内容。'
  })
});

const result = await response.json();
if (result.success) {
  console.log('下载链接:', result.downloadUrl);
  console.log('文件大小:', result.size);
}
```

### Python 调用示例
```python
import requests

# 调用转换工具
response = requests.post('http://localhost:3000/tools/markdown_to_word', 
  json={
    'name': '我的文档', 
    'content': '# 标题\n\n这是 **测试** 内容。'
  })

result = response.json()
if result['success']:
    print(f"下载链接: {result['downloadUrl']}")
    print(f"文件大小: {result['size']} bytes")
```

## 📊 响应格式

### 成功响应
```json
{
  "success": true,
  "message": "转换成功",
  "downloadUrl": "http://localhost:3000/download/uuid-here",
  "filename": "我的文档_uuid.docx",
  "size": 12345,
  "expiresAt": "2024-01-01T12:30:00.000Z"
}
```

### 错误响应
```json
{
  "success": false,
  "error": "Missing required parameters: name and content"
}
```

## 🔍 调试和测试

### 1. 健康检查
```bash
curl http://localhost:3000/health
```

### 2. 查看服务信息
```bash
curl http://localhost:3000/mcp-info
```

### 3. 使用Swagger UI测试
访问 `http://localhost:3000/docs` 进行交互式测试

### 4. 运行自动化测试
```bash
node test-openapi.js
```

## ⚡ 高级特性

### 1. SSE 格式支持
```javascript
// 请求SSE格式响应
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  })
});
```

### 2. 批量处理
可以通过MCP协议端点进行批量操作和会话管理。

### 3. 文件管理
- 文件自动过期（30分钟）
- 自动清理机制
- 临时下载链接

## 🚨 注意事项

1. **服务地址**: 确保OpenWebUI可以访问 `http://localhost:3000`
2. **CORS**: 已配置允许跨域访问
3. **文件大小**: Markdown内容最大支持100KB
4. **文件过期**: 生成的文档30分钟后自动删除
5. **网络**: 如果OpenWebUI运行在不同机器上，需要修改服务地址

## 🔧 故障排除

### 常见问题

1. **连接失败**: 检查服务是否启动，端口是否被占用
2. **CORS错误**: 确认已启用跨域支持
3. **参数错误**: 检查请求参数格式和必填字段
4. **下载失败**: 检查文件是否已过期或被删除

### 日志查看
服务会输出详细的请求和响应日志，便于调试。

## 🎯 最佳实践

1. 使用OpenAPI规范进行自动配置
2. 实现错误处理和重试机制  
3. 定期检查服务健康状态
4. 合理设置超时时间
5. 缓存常用配置和结果

---

*更多信息请访问: http://localhost:3000/docs*
