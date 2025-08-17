import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 环境变量配置
const PORT = process.env.PORT || 3000;
const BASEPATH = process.env.BASEPATH || '/md-to-doc';
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3000';
const HOST = process.env.HOST || 'localhost';
const PROTOCOL = process.env.PROTOCOL || 'http';
const FILE_EXPIRY_MINUTES = parseInt(process.env.FILE_EXPIRY_MINUTES) || 30;
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.CLEANUP_INTERVAL_MINUTES) || 5;

// 构建完整的基础URL
const BASE_URL = `${PROTOCOL}://${HOST}:${PORT}`;

// 创建 OpenAPI 规范实例（基于动态 basepath）
const openApiSpec = createOpenApiSpec(BASEPATH);

// Pandoc相关依赖
const execAsync = promisify(exec);

// 文档转换依赖
import { marked } from 'marked';
import { JSDOM } from 'jsdom';

// MCP SDK imports
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// OpenAPI support
import swaggerUi from 'swagger-ui-express';
import { createOpenApiSpec } from './openapi-spec.js';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 中间件配置
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Cache-Control'],
    credentials: true
}));

// JSON 解析中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// 确保下载目录存在
const downloadsDir = path.join(__dirname, 'downloads');
fs.ensureDirSync(downloadsDir);

// 存储文件信息
const fileStorage = new Map();

// 服务器信息
const SERVER_INFO = {
    name: "mcp-document-service",
    version: "1.0.0",
    description: "MCP服务：Markdown转Word文档转换，支持SSE和HTTP传输"
};

// 日志辅助函数
function logRequest(method, path, body = null, headers = null) {
    const timestamp = new Date().toISOString();
    console.log(`\n📨 [${timestamp}] 收到请求:`);
    console.log(`   方法: ${method}`);
    console.log(`   路径: ${path}`);
    if (headers) {
        console.log(`   头部:`, JSON.stringify(headers, null, 2));
    }
    if (body) {
        console.log(`   请求体:`, JSON.stringify(body, null, 2));
    }
}

function logResponse(status, data, responseTime = null) {
    const timestamp = new Date().toISOString();
    console.log(`\n📤 [${timestamp}] 发送响应:`);
    console.log(`   状态码: ${status}`);
    if (responseTime) {
        console.log(`   响应时间: ${responseTime}ms`);
    }
    if (data) {
        // 完整打印响应数据，不截断
        console.log(`   响应体:`, JSON.stringify(data, null, 2));
    }
    console.log('   ---');
}

// 辅助函数：根据客户端支持返回不同格式的响应
function sendResponse(res, status, responseData, supportsSSE, responseTime) {
    logResponse(status, responseData, responseTime);
    
    if (supportsSSE) {
        // 返回 SSE 格式
        const eventType = responseData.error ? 'error' : 'message';
        const messageId = responseData.id || Date.now();
        const sseData = `id:${messageId}\nevent:${eventType}\ndata:${JSON.stringify(responseData)}\n\n`;
        console.log(`📡 发送SSE格式响应: event=${eventType}, id=${messageId}`);
        return res.status(status).send(sseData);
    } else {
        // 返回普通 JSON
        console.log(`📄 发送JSON格式响应`);
        return res.status(status).json(responseData);
    }
}

// 清理过期文件的函数
function cleanupExpiredFiles() {
    const now = Date.now();
    let cleanupCount = 0;
    
    console.log(`🧹 开始清理过期文件，当前活跃文件数: ${fileStorage.size}`);
    
    fileStorage.forEach((fileInfo, fileId) => {
        if (now > fileInfo.expiresAt) {
            fs.remove(fileInfo.filePath).catch(console.error);
            fileStorage.delete(fileId);
            cleanupCount++;
        }
    });
    
    if (cleanupCount > 0) {
        console.log(`✅ 清理完成，已删除 ${cleanupCount} 个过期文件，剩余活跃文件数: ${fileStorage.size}`);
    } else {
        console.log(`✅ 清理完成，无过期文件需要删除，当前活跃文件数: ${fileStorage.size}`);
    }
}

// 定时清理过期文件
setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL_MINUTES * 60 * 1000);

// 检查Pandoc是否可用
async function checkPandocAvailability() {
    try {
        await execAsync('pandoc --version');
        return true;
    } catch (error) {
        console.warn('⚠️ Pandoc未安装或不可用，将使用备用转换方法');
        return false;
    }
}

// 使用Pandoc进行Markdown到Word转换
async function markdownToWordPandoc(markdownContent, filename) {
    try {
        const tempDir = path.join(__dirname, 'temp');
        await fs.ensureDir(tempDir);
        
        // 创建临时markdown文件
        const tempMdFile = path.join(tempDir, `${uuidv4()}.md`);
        const outputFile = path.join(downloadsDir, filename);
        
        // 写入markdown内容
        await fs.writeFile(tempMdFile, markdownContent, 'utf8');
        
        // 使用Pandoc转换
        const pandocCommand = `pandoc "${tempMdFile}" -o "${outputFile}" --from markdown --to docx`;
        console.log(`🔄 执行Pandoc命令: ${pandocCommand}`);
        
        await execAsync(pandocCommand);
        
        // 清理临时文件
        await fs.remove(tempMdFile);
        
        console.log(`✅ Pandoc转换完成: ${filename}`);
        return outputFile;
    } catch (error) {
        console.error('❌ Pandoc转换失败:', error);
        throw new Error(`Pandoc转换失败: ${error.message}`);
    }
}

// 备用转换方法（基于marked + 简单Word生成）
async function markdownToWordFallback(markdownContent, filename) {
    try {
        const html = marked.parse(markdownContent);
        const outputFile = path.join(downloadsDir, filename);
        
        // 简化的Word文档生成（基于HTML结构）
        const wordContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        ${convertHtmlToWordXml(html)}
    </w:body>
</w:document>`;
        
        // 创建基本的Word文档结构
        const JSZip = await import('jszip');
        const zip = new JSZip.default();
        
        // 添加必要的Word文档文件
        zip.file('[Content_Types].xml', getContentTypesXml());
        zip.file('_rels/.rels', getRelsXml());
        zip.file('word/_rels/document.xml.rels', getDocumentRelsXml());
        zip.file('word/document.xml', wordContent);
        
        const buffer = await zip.generateAsync({ type: 'nodebuffer' });
        await fs.writeFile(outputFile, buffer);
        
        console.log(`✓ 备用方法转换完成: ${filename}`);
        return outputFile;
    } catch (error) {
        console.error('✗ 备用转换方法失败:', error);
        throw new Error(`转换失败: ${error.message}`);
    }
}

// 辅助函数：将HTML转换为Word XML
function convertHtmlToWordXml(html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    let wordXml = '';
    
    function processElement(element) {
        if (element.nodeType === 3) {
            // 文本节点
            const text = element.textContent.trim();
            if (text) {
                return `<w:r><w:t>${escapeXml(text)}</w:t></w:r>`;
            }
            return '';
        }
        
        if (element.nodeType === 1) {
            const tagName = element.tagName.toLowerCase();
            let content = '';
            
            // 处理子节点
            for (const child of element.childNodes) {
                content += processElement(child);
            }
              switch (tagName) {
                case 'h1':
                case 'h2':
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6':
                    const headingLevel = parseInt(tagName.charAt(1));
                    const fontSize = 24 - (headingLevel - 1) * 2;
                    return `<w:p>
                        <w:pPr>
                            <w:pStyle w:val="Heading${headingLevel}"/>
                        </w:pPr>
                        <w:r>
                            <w:rPr>
                                <w:b/>
                                <w:sz w:val="${fontSize}"/>
                            </w:rPr>
                            <w:t>${escapeXml(element.textContent)}</w:t>
                        </w:r>
                    </w:p>`;
                
                case 'p':
                    return `<w:p>${content}</w:p>`;
                
                case 'pre':
                    // 代码块处理
                    const codeContent = element.textContent || '';
                    const codeLines = codeContent.split('\n');
                    let preXml = '';
                    codeLines.forEach((line, index) => {
                        preXml += `<w:p>
                            <w:pPr>
                                <w:pStyle w:val="Code"/>
                                <w:spacing w:before="0" w:after="0"/>
                            </w:pPr>
                            <w:r>
                                <w:rPr>
                                    <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>
                                    <w:sz w:val="18"/>
                                    <w:color w:val="000080"/>
                                </w:rPr>
                                <w:t xml:space="preserve">${escapeXml(line)}</w:t>
                            </w:r>
                        </w:p>`;
                    });
                    return preXml;
                
                case 'code':
                    // 内联代码处理
                    if (element.parentElement && element.parentElement.tagName.toLowerCase() === 'pre') {
                        // 如果code在pre内部，已经在pre中处理了
                        return '';
                    }
                    return `<w:r>
                        <w:rPr>
                            <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>
                            <w:sz w:val="18"/>
                            <w:color w:val="000080"/>
                            <w:highlight w:val="lightGray"/>
                        </w:rPr>
                        <w:t>${escapeXml(element.textContent)}</w:t>
                    </w:r>`;
                
                case 'strong':
                case 'b':
                    return `<w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(element.textContent)}</w:t></w:r>`;
                
                case 'em':
                case 'i':
                    return `<w:r><w:rPr><w:i/></w:rPr><w:t>${escapeXml(element.textContent)}</w:t></w:r>`;
                
                case 'ul':
                case 'ol':
                    let listXml = '';
                    const listItems = element.querySelectorAll('li');
                    listItems.forEach((li, index) => {
                        listXml += `<w:p>
                            <w:pPr>
                                <w:numPr>
                                    <w:ilvl w:val="0"/>
                                    <w:numId w:val="1"/>
                                </w:numPr>
                            </w:pPr>
                            <w:r><w:t>${escapeXml(li.textContent)}</w:t></w:r>
                        </w:p>`;
                    });
                    return listXml;
                
                case 'br':
                    return `<w:r><w:br/></w:r>`;
                
                case 'hr':
                    return `<w:p>
                        <w:pPr>
                            <w:pBdr>
                                <w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/>
                            </w:pBdr>
                        </w:pPr>
                    </w:p>`;
                
                default:
                    return content;
            }
        }
        
        return '';
    }
    
    const bodyElements = document.body.children;
    for (const element of bodyElements) {
        wordXml += processElement(element);
    }
    
    return wordXml || '<w:p><w:r><w:t>文档内容</w:t></w:r></w:p>';
}

// XML转义函数
function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Word文档必需的XML文件内容
function getContentTypesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
}

function getRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function getDocumentRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
}

// 主要的Markdown转Word函数
async function markdownToWord(markdownContent, filename) {
    const isPandocAvailable = await checkPandocAvailability();
    
    if (isPandocAvailable) {
        console.log('📄 使用Pandoc进行转换');
        return await markdownToWordPandoc(markdownContent, filename);
    } else {
        console.log('📄 使用备用方法进行转换');
        return await markdownToWordFallback(markdownContent, filename);
    }
}

// Markdown转Word工具的执行函数
async function executeMarkdownToWord(args) {
    try {
        const { name, content } = args;
        
        // 输入验证
        if (!name || typeof name !== 'string') {
            throw new Error('缺少必需参数：name (string)');
        }
        
        if (!content || typeof content !== 'string') {
            throw new Error('缺少必需参数：content (string)');
        }
        
        // 验证文件
        if (name.length > 100 || !/^[^<>:"/\\|?*]+$/.test(name)) {
            throw new Error('文件名无效或过长');
        }
        
        if (content.length > 100000) {
            throw new Error('内容过长，最大支持500KB');
        }
          console.log(`📝 开始处理Markdown转Word: ${name}`);
        
        // 生成唯一文件名
        const fileId = uuidv4();
        const filename = `${name}_${fileId}.docx`;
        
        // 直接将Markdown转换为Word文档
        const filePath = await markdownToWord(content, filename);
          // 计算过期时间
        const expiresAt = Date.now() + (FILE_EXPIRY_MINUTES * 60 * 1000);
        
        // 存储文件信息
        fileStorage.set(fileId, {
            filePath,
            filename,
            expiresAt,
            originalName: name
        });        // 生成下载链接（完整URL）
        const downloadUrl = `${PROXY_URL}${BASEPATH}/download/${fileId}`;
        
        console.log(`✓ 转换完成: ${filename}`);
        
        return {
            content: [
                {
                    type: "text",                    text: `📄 文档转换成功！

**文档名称:** ${name}
**文件大小:** ${(await fs.stat(filePath)).size} bytes
**过期时间:** 30分钟后自动删除

✨ 转换功能:
- 支持标题 (H1-H6)
- 支持粗体和斜体
- 支持列表
- 支持代码块和内联代码
- 支持段落和换行
- 支持水平分隔线

📥 <a href="${downloadUrl}" download="${name}.docx">点击此处下载Word文档</a>`
                }
            ]
        };
    } catch (error) {
        console.error('✗ Markdown转Word失败:', error);
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `❌ 转换失败: ${error.message}`
                }
            ]
        };
    }
}

// 创建MCP Server实例
const server = new Server(
    SERVER_INFO,
    {
        capabilities: {
            tools: {}
        }
    }
);

// 注册工具列表处理器
server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log('📋 收到工具列表请求');
    return {
        tools: [
            {
                name: "markdown_to_word",
                description: "将Markdown文本转换为Word文档并提供下载链接。支持标题、粗体、斜体、列表等常见Markdown元素",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "文档名称，用作生成的Word文档的文件名基础",
                            minLength: 1,
                            maxLength: 100
                        },
                        content: {
                            type: "string",
                            description: "要转换的Markdown内容，支持标题(#)、粗体(**)、斜体(*)、列表(-)等格式",
                            minLength: 1,
                            maxLength: 100000
                        }
                    },
                    required: ["name", "content"],
                    additionalProperties: false
                }
            }
        ]
    };
});

// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    console.log(`🔧 收到工具调用请求: ${name}`);
    
    if (name === "markdown_to_word") {
        return await executeMarkdownToWord(args);
    } else {
        throw new Error(`未知的工具: ${name}`);
    }
});

// SSE 连接管理
const sseConnections = new Set();

// SSE 端点（已弃用，推荐使用 /mcp 端点）
app.get(`${BASEPATH}/sse`, (req, res) => {
    const startTime = Date.now();
    logRequest('GET', `${BASEPATH}/sse`, null, req.headers);
    
    console.log('⚠️  SSE 端点已弃用，建议使用 /mcp 端点');
    console.log('🔌 尝试建立SSE连接');
    
    try {
        // 创建 SSE 传输，让它自己处理头部设置
        const transport = new SSEServerTransport(req, res);
        
        // 连接到 MCP server
        server.connect(transport);
        
        // 管理连接
        sseConnections.add(res);
        
        console.log(`📊 SSE连接建立成功，当前活跃连接数: ${sseConnections.size}`);
        
        // 清理连接
        req.on('close', () => {
            const responseTime = Date.now() - startTime;
            console.log('🔌 SSE连接已关闭');
            console.log(`📊 连接时长: ${responseTime}ms`);
            sseConnections.delete(res);
            try {
                transport.close();        } catch (error) {
                console.log('清理传输时出错', error.message);
            }
        });
        
        req.on('error', (error) => {
            const responseTime = Date.now() - startTime;
            console.error('✗ SSE连接错误:', error.message);
            logResponse(500, { error: error.message }, responseTime);
            sseConnections.delete(res);
            try {
                transport.close();            } catch (error) {
                console.log('清理传输时出错', error.message);
            }
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error('✗ SSE端点错误:', error);
        
        // 只有在响应还没有开始时才能设置状态码和头部
        if (!res.headersSent) {
            const errorResponse = { 
                error: 'SSE endpoint deprecated', 
                message: 'Please use /mcp endpoint instead',
                recommendation: {
                    method: 'POST',
                    url: '/mcp',
                    contentType: 'application/json'
                }
            };
            logResponse(500, errorResponse, responseTime);
            res.status(500).json(errorResponse);
        }
    }
});

// MCP HTTP 端点（支持 StreamableHttp 和传统 HTTP）
app.get(`${BASEPATH}/mcp`, (req, res) => {
    const startTime = Date.now();
    logRequest('GET', `${BASEPATH}/mcp`, null, req.headers);
    
    console.log('🌐 收到MCP GET请求 (StreamableHttp)');
    
    // 检查客户端是否支持 SSE 格式
    const acceptHeader = req.headers.accept || '';
    const supportsSSE = acceptHeader.includes('text/event-stream');    console.log(`📋 客户端格式支持: ${supportsSSE ? 'SSE' : 'JSON'} (Accept: ${acceptHeader})`);
    
    // 设置基础头部
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Cache-Control');
    
    if (supportsSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    } else {
        res.setHeader('Content-Type', 'application/json');
    }
    
    // 返回服务器信息和能力
    const responseData = {
        jsonrpc: "2.0",
        result: {
            protocolVersion: "2024-11-05",
            capabilities: {
                tools: { list: true, call: true },
                resources: {},
                prompts: {}
            },
            serverInfo: SERVER_INFO,
            transport: "StreamableHttp",
            endpoints: {
                tools: "/mcp",
                health: "/health"
            }
        }
    };
    
    const responseTime = Date.now() - startTime;
    return sendResponse(res, 200, responseData, supportsSSE, responseTime);
});

// OPTIONS 请求处理（CORS 预检）
app.options(`${BASEPATH}/mcp`, (req, res) => {
    const startTime = Date.now();
    logRequest('OPTIONS', `${BASEPATH}/mcp`, null, req.headers);
    
    console.log('🔍 收到 OPTIONS 预检请求');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Cache-Control');
    
    const responseTime = Date.now() - startTime;
    logResponse(200, { message: 'CORS preflight successful' }, responseTime);
    
    res.status(200).end();
});

app.post(`${BASEPATH}/mcp`, async (req, res) => {
    const startTime = Date.now();
    logRequest('POST', `${BASEPATH}/mcp`, req.body, req.headers);
    
    try {
        console.log('📨 收到MCP HTTP请求:', {
            method: req.body?.method,
            id: req.body?.id
        });
        
        // 检查客户端是否支持 SSE 格式
        const acceptHeader = req.headers.accept || '';        const supportsSSE = acceptHeader.includes('text/event-stream');
        console.log(`📋 客户端格式支持: ${supportsSSE ? 'SSE' : 'JSON'} (Accept: ${acceptHeader})`);
        
        // 设置基础头部
        if (supportsSSE) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
        } else {
            res.setHeader('Content-Type', 'application/json');
        }
          // 验证请求体
        if (!req.body || typeof req.body !== 'object') {
            const errorResponse = {
                jsonrpc: "2.0",
                id: req.body?.id || null,
                error: {
                    code: -32700,
                    message: "Parse error"
                }
            };
            const responseTime = Date.now() - startTime;
            logResponse(400, errorResponse, responseTime);
            
            if (supportsSSE) {
                const sseData = `id:${req.body?.id || 'null'}\nevent:error\ndata:${JSON.stringify(errorResponse)}\n\n`;
                return res.status(400).send(sseData);
            } else {
                return res.status(400).json(errorResponse);
            }
        }
        
        const { jsonrpc, id, method, params } = req.body;        // 检查是否是通知
        const isNotification = id === undefined;
          if (isNotification) {
            console.log(`🔔 处理通知: ${method}`);
            if (method === "notifications/initialized") {
                console.log('✓ 客户端初始化完成');
            }
            const responseTime = Date.now() - startTime;
            console.log(`📤 [${new Date().toISOString()}] 通知处理完成 (无响应体)`);
            console.log(`   响应时间: ${responseTime}ms`);
            console.log('   ---');
            // 通知不返回响应体，但需要发送 HTTP 204 状态码确认收到
            return res.status(204).end();
        }
            
        // 处理请求
        switch (method) {            case "initialize":
                console.log('🚀 初始化MCP连接');
                const initResponse = {
                    jsonrpc: "2.0",
                    id: id,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {
                            tools: { list: true, call: true },
                            resources: {},
                            prompts: {}
                        },
                        serverInfo: SERVER_INFO
                    }
                };
                const initTime = Date.now() - startTime;
                return sendResponse(res, 200, initResponse, supportsSSE, initTime);
                
            case "tools/list":
                console.log('📋 处理工具列表请求');
                const toolsResult = {
                    tools: [
                        {
                            name: "markdown_to_word",
                            description: "将Markdown文本转换为Word文档并提供下载链接。支持标题、粗体、斜体、列表等常见Markdown元素。",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "文档名称，用作生成的Word文档的文件名基础",
                                        minLength: 1,
                                        maxLength: 100
                                    },
                                    content: {
                                        type: "string",
                                        description: "要转换的Markdown内容，支持标题(#)、粗体(**)、斜体(*)、列表(-)等格式",
                                        minLength: 1,
                                        maxLength: 100000
                                    }
                                },
                                required: ["name", "content"],
                                additionalProperties: false
                            }
                        }
                    ]
                };
                const toolsResponse = {
                    jsonrpc: "2.0",
                    id: id,
                    result: toolsResult
                };
                const toolsTime = Date.now() - startTime;
                return sendResponse(res, 200, toolsResponse, supportsSSE, toolsTime);
                  case "tools/call":
                if (!params || !params.name || !params.arguments) {
                    const paramErrorResponse = {
                        jsonrpc: "2.0",
                        id: id,
                        error: {
                            code: -32602,
                            message: "Invalid params"
                        }
                    };
                    const paramErrorTime = Date.now() - startTime;
                    return sendResponse(res, 400, paramErrorResponse, supportsSSE, paramErrorTime);
                }
                
                console.log(`🔧 处理工具调用请求: ${params.name}`);
                console.log(`   参数:`, params.arguments);
                
                if (params.name === "markdown_to_word") {
                    const callResult = await executeMarkdownToWord(params.arguments);
                    const callResponse = {
                        jsonrpc: "2.0",
                        id: id,
                        result: callResult
                    };
                    const callTime = Date.now() - startTime;
                    return sendResponse(res, 200, callResponse, supportsSSE, callTime);
                } else {
                    const unknownToolResponse = {
                        jsonrpc: "2.0",
                        id: id,
                        error: {
                            code: -32601,
                            message: `未知的工具: ${params.name}`
                        }
                    };
                    const unknownToolTime = Date.now() - startTime;
                    return sendResponse(res, 400, unknownToolResponse, supportsSSE, unknownToolTime);
                }
                  default:
                const notFoundResponse = {
                    jsonrpc: "2.0",
                    id: id,
                    error: {
                        code: -32601,
                        message: "Method not found"
                    }
                };
                const notFoundTime = Date.now() - startTime;
                return sendResponse(res, 400, notFoundResponse, supportsSSE, notFoundTime);
        }    } catch (error) {
        console.error('✗ MCP处理错误:', error);
        const errorResponse = {
            jsonrpc: "2.0",
            id: req.body?.id || null,
            error: {
                code: -32603,
                message: "Internal error",
                data: error.message
            }
        };
        const errorTime = Date.now() - startTime;
        return sendResponse(res, 500, errorResponse, supportsSSE, errorTime);
    }
});

// MCP 服务信息端点
app.get(`${BASEPATH}/mcp-info`, (req, res) => {
    const startTime = Date.now();
    logRequest('GET', `${BASEPATH}/mcp-info`, null, req.headers);
    
    console.log('📋 收到MCP服务信息请求');
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const responseData = {
        name: SERVER_INFO.name,
        version: SERVER_INFO.version,
        description: SERVER_INFO.description,
        protocol: {
            version: "2024-11-05",
            jsonrpc: "2.0"
        },        transports: [
            {
                type: "sse",
                url: `${BASEPATH}/sse`,
                deprecated: true,
                note: "SSE transport is deprecated, use StreamableHttp instead"
            },
            {
                type: "http",
                url: `${BASEPATH}/mcp`,
                method: "POST",
                contentType: "application/json"
            },
            {
                type: "streamable-http",
                url: `${BASEPATH}/mcp`, 
                method: "GET",
                note: "Recommended transport method"
            }
        ],
        capabilities: {
            tools: { list: true, call: true },
            resources: {},
            prompts: {}
        },
        tools: [
            {
                name: "markdown_to_word",
                description: "将Markdown转换为Word文档",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "文档名称" },
                        content: { type: "string", description: "Markdown内容" }
                    },
                    required: ["name", "content"]
                }
            }
        ],        examples: {
            initialize: {
                url: `${BASEPATH}/mcp`,
                method: "POST",
                body: {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "client", version: "1.0.0" }
                    }
                }
            },
            listTools: {
                url: `${BASEPATH}/mcp`,
                method: "POST", 
                body: {
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/list",
                    params: {}
                }
            },
            callTool: {
                url: `${BASEPATH}/mcp`,
                method: "POST",
                body: {
                    jsonrpc: "2.0",
                    id: 3,
                    method: "tools/call",
                    params: {
                        name: "markdown_to_word",
                        arguments: {
                            name: "测试文档",
                            content: "# 标题\n\n这是 **测试** 内容。"
                        }
                    }
                }
            }
        }
    };
    
    const responseTime = Date.now() - startTime;
    logResponse(200, responseData, responseTime);
    
    res.json(responseData);
});

// OpenAPI JSON端点
app.get(`${BASEPATH}/openapi.json`, (req, res) => {
    const startTime = Date.now();
    logRequest('GET', `${BASEPATH}/openapi.json`, null, req.headers);
    
    console.log('📋 收到OpenAPI规范请求');
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const responseTime = Date.now() - startTime;
    logResponse(200, { message: 'OpenAPI spec served', size: JSON.stringify(openApiSpec).length }, responseTime);
    
    res.json(openApiSpec);
});

// Swagger UI文档端点
app.use(`${BASEPATH}/docs`, swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customCssUrl: '/swagger-ui-bundle.css',
    customJs: '/swagger-ui-bundle.js',
    swaggerOptions: {
        url: `${BASEPATH}/openapi.json`,
        docExpansion: 'list',
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        tryItOutEnabled: true,
        filter: true,
        showRequestHeaders: true,
        showCommonExtensions: true
    },
    customSiteTitle: 'MCP Document Service API Documentation'
}));

// 简化的REST API端点 - Markdown转Word工具
app.post(`${BASEPATH}/tools/markdown_to_word`, async (req, res) => {
    const startTime = Date.now();
    logRequest('POST', `${BASEPATH}/tools/markdown_to_word`, req.body, req.headers);
    
    try {
        console.log('📝 收到简化REST API请求: markdown_to_word');
        
        const { name, content } = req.body;
        
        if (!name || !content) {
            const errorResponse = {
                success: false,
                error: "Missing required parameters: name and content"
            };
            const responseTime = Date.now() - startTime;
            logResponse(400, errorResponse, responseTime);
            return res.status(400).json(errorResponse);
        }
        
        // 调用现有的转换函数
        const result = await executeMarkdownToWord({ name, content });
        
        if (result.isError) {
            const errorResponse = {
                success: false,
                error: result.content[0].text
            };
            const responseTime = Date.now() - startTime;
            logResponse(400, errorResponse, responseTime);
            return res.status(400).json(errorResponse);
        }
        
        // 解析结果文本获取下载链接
        const resultText = result.content[0].text;
        const downloadUrlMatch = resultText.match(/\*\*下载链接:\*\* (http[^\s]+)/);
        const downloadUrl = downloadUrlMatch ? downloadUrlMatch[1] : null;
        
        // 从存储中获取文件信息
        const fileId = downloadUrl ? downloadUrl.split('/').pop() : null;
        const fileInfo = fileId ? fileStorage.get(fileId) : null;
        
        const responseData = {
            success: true,
            message: "转换成功",
            downloadUrl: downloadUrl,
            filename: fileInfo ? fileInfo.filename : `${name}.docx`,
            size: fileInfo ? (await fs.stat(fileInfo.filePath).catch(() => ({ size: 0 }))).size : 0,
            expiresAt: fileInfo ? new Date(fileInfo.expiresAt).toISOString() : null
        };
        
        const responseTime = Date.now() - startTime;
        logResponse(200, responseData, responseTime);
        return res.json(responseData);
        
    } catch (error) {
        console.error('✗ REST API错误:', error);
        const errorResponse = {
            success: false,
            error: error.message
        };
        const errorTime = Date.now() - startTime;
        logResponse(500, errorResponse, errorTime);
        return res.status(500).json(errorResponse);
    }
});

// 下载文件路由
app.get(`${BASEPATH}/download/:fileId`, (req, res) => {
    const startTime = Date.now();
    const { fileId } = req.params;
    logRequest('GET', `${BASEPATH}/download/${fileId}`, null, req.headers);
    
    console.log(`📁 收到文件下载请求: ${fileId}`);
    
    const fileInfo = fileStorage.get(fileId);
    
    if (!fileInfo) {
        const notFoundResponse = { error: '文件不存在或已过期' };
        const responseTime = Date.now() - startTime;
        logResponse(404, notFoundResponse, responseTime);
        return res.status(404).json(notFoundResponse);
    }
    
    if (Date.now() > fileInfo.expiresAt) {
        fs.remove(fileInfo.filePath).catch(console.error);
        fileStorage.delete(fileId);
        const expiredResponse = { error: '文件已过期' };
        const responseTime = Date.now() - startTime;
        logResponse(410, expiredResponse, responseTime);
        return res.status(410).json(expiredResponse);
    }
    
    if (!fs.existsSync(fileInfo.filePath)) {
        fileStorage.delete(fileId);
        const missingResponse = { error: '文件不存在' };
        const responseTime = Date.now() - startTime;
        logResponse(404, missingResponse, responseTime);
        return res.status(404).json(missingResponse);
    }
    
    console.log(`📤 开始发送文件: ${fileInfo.originalName} (${fileInfo.filename})`);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.originalName)}.docx"`);
    
    const responseTime = Date.now() - startTime;
    logResponse(200, { 
        message: 'File download started', 
        filename: fileInfo.filename, 
        originalName: fileInfo.originalName 
    }, responseTime);
    
    res.sendFile(fileInfo.filePath);
});

// 健康检查路由
app.get(`${BASEPATH}/health`, (req, res) => {
    const startTime = Date.now();
    logRequest('GET', `${BASEPATH}/health`, null, req.headers);
    
    console.log('🩺 收到健康检查请求');
    const healthData = { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        activeFiles: fileStorage.size,
        sseConnections: sseConnections.size,
        endpoints: {
            sse: `${BASEPATH}/sse`,
            mcp: `${BASEPATH}/mcp`,
            download: `${BASEPATH}/download/:fileId`,
            health: `${BASEPATH}/health`
        }
    };
    
    const responseTime = Date.now() - startTime;
    logResponse(200, healthData, responseTime);
    
    res.json(healthData);
});

// 根路由 - API文档
app.get('/', (req, res) => {
    const startTime = Date.now();
    logRequest('GET', '/', null, req.headers);
    
    console.log('📚 收到API文档请求');
    
    const apiData = {
        name: SERVER_INFO.name,
        description: SERVER_INFO.description,
        version: SERVER_INFO.version,
        protocol: {
            mcp: "2024-11-05",
            jsonrpc: "2.0"
        },        endpoints: {
            [`GET ${BASEPATH}/sse`]: "MCP SSE连接端点（实时通信）",
            [`POST ${BASEPATH}/mcp`]: "MCP HTTP端点（JSON-RPC 2.0）",
            [`GET ${BASEPATH}/download/:fileId`]: "下载转换后的文件",
            [`GET ${BASEPATH}/health`]: "服务健康检查",
            "GET /": "API文档"
        },
        transports: ["SSE", "HTTP"],
        tools: [
            {
                name: "markdown_to_word",
                description: "将Markdown转换为Word文档"
            }
        ],
        features: [
            "📡 Server-Sent Events (SSE) 支持",
            "🌐 HTTP JSON-RPC 2.0 支持",
            "📝 Markdown 转Word 转换",
            "🔗 临时下载链接（有效期30分钟）",
            "🧹 自动文件清理",
            "🔄 向后兼容",
            "📡 实时通信"
        ],
        usage: {
            sse: `使用 EventSource 连接到 ${BASEPATH}/sse 进行实时通信`,
            http: `发送 JSON-RPC 2.0 请求到 ${BASEPATH}/mcp 进行传统通信`
        }
    };
    
    const responseTime = Date.now() - startTime;
    logResponse(200, apiData, responseTime);
    
    res.json(apiData);
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('✗ 未处理的错误:', err);
    
    if (req.path === '/mcp' && req.method === 'POST') {
        return res.json({
            jsonrpc: "2.0",
            id: req.body?.id || null,
            error: {
                code: -32603,
                message: "Internal error"
            }
        });
    }
    
    res.status(500).json({
        error: "Internal Server Error",
        message: err.message
    });
});

// 404 处理
app.use((req, res) => {    res.status(404).json({
        error: "Not Found",
        message: `端点 ${req.path} 不存在`,
        availableEndpoints: [`${BASEPATH}/sse`, `${BASEPATH}/mcp`, `${BASEPATH}/download/:fileId`, `${BASEPATH}/health`, "/"]
    });
});

// 启动服务器
app.listen(PORT, () => {    console.log('\n' + '='.repeat(60));
    console.log('🚀 MCP Document Service 启动成功!');
    console.log('='.repeat(60));
    console.log(`📍 服务地址: ${BASE_URL}`);
    console.log(`🌐 MCP端点: ${BASE_URL}${BASEPATH}/mcp`);
    console.log(`📊 健康检查: ${BASE_URL}${BASEPATH}/health`);
    console.log(`📋 服务信息: ${BASE_URL}${BASEPATH}/mcp-info`);
    console.log(`📂 下载目录: ${downloadsDir}`);
    console.log('');
    console.log('📋 传输协议支持:');
    console.log('   📡 HTTP (JSON-RPC 2.0) - 推荐方式');
    console.log('   📡 StreamableHttp (GET /mcp) - MCP 客户端推送');
    console.log('   ⚠️  SSE (Server-Sent Events) - 已弃用');
    console.log('');
    console.log('🔧 可用工具:');
    console.log('   🛠️ markdown_to_word: Markdown转Word文档');
    console.log('');
    console.log('📡 连接方式:');
    console.log(`   推荐: POST ${BASE_URL}${BASEPATH}/mcp`);
    console.log(`   StreamableHttp: GET ${BASE_URL}${BASEPATH}/mcp`);
    console.log(`   简化REST API: POST ${BASE_URL}${BASEPATH}/tools/markdown_to_word`);
    console.log(`   已弃用 SSE: ${BASE_URL}${BASEPATH}/sse`);
    console.log('');
    console.log('📚 OpenAPI支持:');
    console.log(`   📄 Swagger UI: ${BASE_URL}${BASEPATH}/docs`);
    console.log(`   📋 OpenAPI规范: ${BASE_URL}${BASEPATH}/openapi.json`);
    console.log('   🔧 适配OpenWebUI工具集成');
    console.log('');
    console.log('📦 特性支持:');
    console.log('   📡 支持 MCP 协议 2024-11-05');
    console.log('   📡 支持传统HTTP请求 (JSON-RPC 2.0)');
    console.log('   📡 支持 StreamableHttp 传输');
    console.log('   📡 支持 OpenAPI 3.0 规范');
    console.log('   📡 提供 Swagger UI 文档界面');
    console.log('   📡 简化的REST API端点');
    console.log('   📡 SSE格式响应支持');
    console.log('   🧹 自动文件清理机制');
    console.log('   🔄 向后兼容');
    console.log('');
    console.log('服务器已就绪，等待客户端连接...\n');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n🔄 正在优雅关闭服务器..');
    
    // 清理所有临时文件
    fileStorage.forEach((fileInfo) => {
        fs.remove(fileInfo.filePath).catch(console.error);
    });
    
    // 关闭所有SSE连接
    sseConnections.forEach(connection => {
        try {
            connection.end();
        } catch (error) {
            // 忽略关闭错误
        }
    });
    
    console.log('✓ 服务器已关闭');
    process.exit(0);
});
