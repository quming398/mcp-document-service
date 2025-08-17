// OpenAPI 3.0 规范定义
export function createOpenApiSpec(basePath = '/md-to-doc') {
    // 动态构建 paths 对象
    const paths = {};
    
    // 根路径
    paths["/"] = {
        get: {
            tags: ["Service Info"],
            summary: "获取API文档和服务信息",
            description: "返回服务的基本信息、可用端点和功能特性",
            responses: {
                "200": {
                    description: "成功返回API信息",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    version: { type: "string" },
                                    protocol: {
                                        type: "object",
                                        properties: {
                                            mcp: { type: "string" },
                                            jsonrpc: { type: "string" }
                                        }
                                    },
                                    endpoints: { type: "object" },
                                    features: {
                                        type: "array",
                                        items: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };
    
    // MCP端点
    paths[basePath + "/mcp"] = {
        get: {
            tags: ["MCP Protocol"],
            summary: "MCP StreamableHttp端点",
            description: "获取MCP服务器信息和能力，支持SSE和JSON格式响应",
            parameters: [
                {
                    name: "Accept",
                    in: "header",
                    description: "响应格式：application/json 或 text/event-stream",
                    schema: {
                        type: "string",
                        enum: ["application/json", "text/event-stream"],
                        default: "application/json"
                    }
                }
            ],
            responses: {
                "200": {
                    description: "成功返回服务器能力信息",
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/MCPServerInfo"
                            }
                        },
                        "text/event-stream": {
                            schema: {
                                type: "string",
                                description: "SSE格式的响应数据"
                            }
                        }
                    }
                }
            }
        },
        post: {
            tags: ["MCP Protocol"],
            summary: "MCP JSON-RPC 2.0端点",
            description: "处理MCP协议请求，包括初始化、工具列表、工具调用等",
            parameters: [
                {
                    name: "Accept",
                    in: "header",
                    description: "响应格式：application/json 或 text/event-stream",
                    schema: {
                        type: "string",
                        enum: ["application/json", "text/event-stream"],
                        default: "application/json"
                    }
                }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            $ref: "#/components/schemas/JSONRPCRequest"
                        }
                    }
                }
            },
            responses: {
                "200": {
                    description: "成功处理MCP请求",
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/JSONRPCResponse"
                            }
                        },
                        "text/event-stream": {
                            schema: {
                                type: "string",
                                description: "SSE格式的响应数据"
                            }
                        }
                    }
                },
                "204": {
                    description: "通知请求已处理（无响应体）"
                },
                "400": {
                    description: "请求错误",
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/JSONRPCError"
                            }
                        }
                    }
                },
                "500": {
                    description: "服务器内部错误",
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/JSONRPCError"
                            }
                        }
                    }
                }
            }
        }
    };
    
    // 文档转换工具端点
    paths[basePath + "/tools/markdown_to_word"] = {
        post: {
            tags: ["Document Conversion"],
            summary: "Markdown转Word文档",
            description: "将Markdown文本转换为Word文档并返回下载链接",
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name", "content"],
                            properties: {
                                name: {
                                    type: "string",
                                    description: "文档名称，用作生成的Word文档的文件名基础",
                                    minLength: 1,
                                    maxLength: 100,
                                    example: "我的文档"
                                },
                                content: {
                                    type: "string",
                                    description: "要转换的Markdown内容，支持标题(#)、粗体(**)、斜体(*)、列表(-)等格式",
                                    minLength: 1,
                                    maxLength: 100000,
                                    example: "# 标题\n\n这是一个**测试**文档。\n\n- 列表项1\n- 列表项2"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                "200": {
                    description: "转换成功",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "转换成功" },
                                    downloadUrl: { 
                                        type: "string", 
                                        format: "uri",
                                        example: basePath + "/download/uuid-here"
                                    },
                                    filename: { type: "string", example: "我的文档_uuid.docx" },
                                    size: { type: "number", example: 12345 },
                                    expiresAt: { 
                                        type: "string", 
                                        format: "date-time",
                                        example: "2024-01-01T12:30:00Z"
                                    }
                                }
                            }
                        }
                    }
                },
                "400": {
                    description: "请求参数错误",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: false },
                                    error: { type: "string" }
                                }
                            }
                        }
                    }
                }
            }
        }
    };
    
    // 文件下载端点
    paths[basePath + "/download/{fileId}"] = {
        get: {
            tags: ["File Management"],
            summary: "下载转换后的文档",
            description: "通过文件ID下载之前转换的Word文档",
            parameters: [
                {
                    name: "fileId",
                    in: "path",
                    required: true,
                    description: "文件唯一标识符",
                    schema: {
                        type: "string",
                        format: "uuid"
                    }
                }
            ],
            responses: {
                "200": {
                    description: "文件下载成功",
                    content: {
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
                            schema: {
                                type: "string",
                                format: "binary"
                            }
                        }
                    },
                    headers: {
                        "Content-Disposition": {
                            description: "文件下载头",
                            schema: {
                                type: "string",
                                example: "attachment; filename=\"document.docx\""
                            }
                        }
                    }
                },
                "404": {
                    description: "文件不存在或已过期",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    error: { type: "string", example: "文件不存在或已过期" }
                                }
                            }
                        }
                    }
                },
                "410": {
                    description: "文件已过期",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    error: { type: "string", example: "文件已过期" }
                                }
                            }
                        }
                    }
                }
            }
        }
    };
    
    // 健康检查端点
    paths[basePath + "/health"] = {
        get: {
            tags: ["Service Info"],
            summary: "健康检查",
            description: "检查服务状态和系统指标",
            responses: {
                "200": {
                    description: "服务正常",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "string", example: "ok" },
                                    timestamp: { type: "string", format: "date-time" },
                                    activeFiles: { type: "number", example: 5 },
                                    sseConnections: { type: "number", example: 2 },
                                    endpoints: {
                                        type: "object",
                                        properties: {
                                            sse: { type: "string", example: basePath + "/sse" },
                                            mcp: { type: "string", example: basePath + "/mcp" },
                                            download: { type: "string", example: basePath + "/download/:fileId" },
                                            health: { type: "string", example: basePath + "/health" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };
    
    // MCP信息端点
    paths[basePath + "/mcp-info"] = {
        get: {
            tags: ["MCP Protocol"],
            summary: "MCP服务信息",
            description: "获取详细的MCP协议服务信息和示例",
            responses: {
                "200": {
                    description: "成功返回MCP服务信息",
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/MCPServiceInfo"
                            }
                        }
                    }
                }
            }
        }
    };
    
    // OpenAPI规范端点
    paths[basePath + "/openapi.json"] = {
        get: {
            tags: ["OpenAPI"],
            summary: "获取OpenAPI规范",
            description: "返回完整的OpenAPI 3.0规范JSON",
            responses: {
                "200": {
                    description: "OpenAPI规范",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                description: "OpenAPI 3.0规范"
                            }
                        }
                    }
                }
            }
        }
    };
    
    // Swagger UI端点
    paths[basePath + "/docs"] = {
        get: {
            tags: ["OpenAPI"],
            summary: "Swagger UI文档界面",
            description: "交互式API文档界面",
            responses: {
                "200": {
                    description: "Swagger UI HTML页面",
                    content: {
                        "text/html": {
                            schema: {
                                type: "string"
                            }
                        }
                    }
                }
            }
        }
    };
    
    // SSE端点（已弃用）
    paths[basePath + "/sse"] = {
        get: {
            tags: ["MCP Protocol"],
            summary: "Server-Sent Events端点（已弃用）",
            description: "已弃用的SSE端点，建议使用 /mcp 端点",
            deprecated: true,
            responses: {
                "200": {
                    description: "SSE连接建立",
                    content: {
                        "text/event-stream": {
                            schema: {
                                type: "string",
                                description: "SSE数据流"
                            }
                        }
                    }
                }
            }
        }
    };
    
    return {
        openapi: "3.0.0",
        info: {
            title: "MCP Document Service API",
            version: "1.0.0",
            description: `
MCP文档服务API，支持Markdown到Word文档的转换。

## 特性
- 📝 Markdown到Word文档转换
- 📡 MCP协议支持 (2024-11-05)
- 🌐 HTTP JSON-RPC 2.0端点
- 🔗 临时下载链接（30分钟有效）
- 🧹 自动文件清理机制
- ⚡ Server-Sent Events支持

## 传输方式
- **HTTP POST ${basePath}/mcp**: JSON-RPC 2.0协议（推荐）
- **HTTP GET ${basePath}/mcp**: StreamableHttp协议
- **SSE ${basePath}/sse**: Server-Sent Events（已弃用）

## 工具集成
本API特别适合集成到：
- OpenWebUI
- MCP兼容客户端
- 自动化工作流
- 文档处理管道
            `.trim(),
            contact: {
                name: "MCP Document Service",
                url: basePath
            },
            license: {
                name: "MIT",
                url: "https://opensource.org/licenses/MIT"
            }
        },
        servers: [
            {
                url: basePath,
                description: "本地开发服务器"
            }
        ],
        tags: [
            {
                name: "MCP Protocol",
                description: "Model Context Protocol相关端点"
            },
            {
                name: "Document Conversion",
                description: "文档转换工具"
            },
            {
                name: "File Management", 
                description: "文件下载和管理"
            },
            {
                name: "Service Info",
                description: "服务信息和健康检查"
            },
            {
                name: "OpenAPI",
                description: "OpenAPI文档和集成"
            }
        ],
        paths: paths,
        components: {
            schemas: {
                JSONRPCRequest: {
                    type: "object",
                    required: ["jsonrpc", "method"],
                    properties: {
                        jsonrpc: { 
                            type: "string", 
                            enum: ["2.0"],
                            description: "JSON-RPC协议版本" 
                        },
                        id: { 
                            oneOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "null" }
                            ],
                            description: "请求ID，通知请求可以省略" 
                        },
                        method: { 
                            type: "string",
                            enum: ["initialize", "tools/list", "tools/call", "notifications/initialized"],
                            description: "MCP方法名" 
                        },
                        params: { 
                            type: "object",
                            description: "方法参数" 
                        }
                    },
                    examples: [
                        {
                            jsonrpc: "2.0",
                            id: 1,
                            method: "initialize",
                            params: {
                                protocolVersion: "2024-11-05",
                                capabilities: {},
                                clientInfo: { name: "client", version: "1.0.0" }
                            }
                        }
                    ]
                },
                JSONRPCResponse: {
                    type: "object",
                    required: ["jsonrpc"],
                    properties: {
                        jsonrpc: { type: "string", enum: ["2.0"] },
                        id: { 
                            oneOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "null" }
                            ]
                        },
                        result: { 
                            type: "object",
                            description: "成功响应的结果" 
                        },
                        error: { 
                            $ref: "#/components/schemas/JSONRPCErrorObject"
                        }
                    }
                },
                JSONRPCError: {
                    type: "object",
                    required: ["jsonrpc", "id", "error"],
                    properties: {
                        jsonrpc: { type: "string", enum: ["2.0"] },
                        id: { 
                            oneOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "null" }
                            ]
                        },
                        error: { 
                            $ref: "#/components/schemas/JSONRPCErrorObject"
                        }
                    }
                },
                JSONRPCErrorObject: {
                    type: "object",
                    required: ["code", "message"],
                    properties: {
                        code: { 
                            type: "integer",
                            description: "错误代码"
                        },
                        message: { 
                            type: "string",
                            description: "错误消息"
                        },
                        data: { 
                            description: "附加错误数据"
                        }
                    }
                },
                MCPServerInfo: {
                    type: "object",
                    properties: {
                        jsonrpc: { type: "string", enum: ["2.0"] },
                        result: {
                            type: "object",
                            properties: {
                                protocolVersion: { type: "string", example: "2024-11-05" },
                                capabilities: {
                                    type: "object",
                                    properties: {
                                        tools: {
                                            type: "object",
                                            properties: {
                                                list: { type: "boolean" },
                                                call: { type: "boolean" }
                                            }
                                        },
                                        resources: { type: "object" },
                                        prompts: { type: "object" }
                                    }
                                },
                                serverInfo: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        version: { type: "string" },
                                        description: { type: "string" }
                                    }
                                },
                                transport: { type: "string", example: "StreamableHttp" },
                                endpoints: {
                                    type: "object",
                                    properties: {
                                        tools: { type: "string" },
                                        health: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                },
                MCPServiceInfo: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        version: { type: "string" },
                        description: { type: "string" },
                        protocol: {
                            type: "object",
                            properties: {
                                version: { type: "string" },
                                jsonrpc: { type: "string" }
                            }
                        },
                        transports: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    type: { type: "string" },
                                    url: { type: "string" },
                                    method: { type: "string" },
                                    deprecated: { type: "boolean" },
                                    note: { type: "string" }
                                }
                            }
                        },
                        capabilities: { type: "object" },
                        tools: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    inputSchema: { type: "object" }
                                }
                            }
                        },
                        examples: { type: "object" }
                    }
                }
            }
        }
    };
}

// 默认导出
export default createOpenApiSpec;
