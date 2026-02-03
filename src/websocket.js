/**
 * WebSocket 服务模块
 * 
 * 处理实时通信：
 * 1. 推送屏幕画面（二进制传输）
 * 2. 接收控制指令
 * 
 * 性能优化：
 * - 二进制传输替代 Base64，减少 33% 数据量
 * - 异步流水线推流
 */

const WebSocket = require('ws');
const { captureScreenBuffer } = require('./capture');
const input = require('./input');
const auth = require('./auth');

class WebSocketServer {
    constructor(httpServer, frameInterval = 33) {
        this.wss = new WebSocket.Server({ server: httpServer });
        this.clients = new Set();
        this.frameInterval = frameInterval;
        this.isStreaming = false;
        this.streamTimer = null;
        this.frameCount = 0;
        this.lastFpsTime = Date.now();

        this.init();
    }

    // 检查是否为本机 IP
    isLocalIP(ip) {
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }

    init() {
        this.wss.on('connection', (ws, req) => {
            const clientIP = req.socket.remoteAddress;

            // 远程连接需要验证 Token
            if (!this.isLocalIP(clientIP)) {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const token = url.searchParams.get('token');

                if (!token || !auth.validateSession(token)) {
                    console.log(`[拒绝] 未授权连接: ${clientIP}`);
                    ws.close(4001, 'Unauthorized');
                    return;
                }
            }

            console.log(`[连接] 新客户端: ${clientIP}`);

            this.clients.add(ws);

            // 发送屏幕尺寸
            const screenSize = input.getScreenSize();
            this.send(ws, {
                type: 'init',
                screenWidth: screenSize.width,
                screenHeight: screenSize.height,
                binaryMode: true // 告知客户端使用二进制模式
            });

            // 开始推流
            if (!this.isStreaming) {
                this.startStreaming();
            }

            // 处理消息
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(ws, message);
                } catch (error) {
                    console.error('消息解析失败:', error.message);
                }
            });

            // 处理关闭
            ws.on('close', () => {
                console.log(`[断开] 客户端: ${clientIP}`);
                this.clients.delete(ws);

                if (this.clients.size === 0) {
                    this.stopStreaming();
                }
            });

            // 处理错误
            ws.on('error', (error) => {
                console.error('WebSocket 错误:', error.message);
                this.clients.delete(ws);
            });
        });

        console.log('[WebSocket] 服务已启动');
    }

    /**
     * 处理客户端消息
     */
    handleMessage(ws, message) {
        const { type } = message;

        switch (type) {
            case 'mousemove':
                input.moveMouse(message.x, message.y);
                break;

            case 'click':
                input.mouseClick(message.x, message.y, message.button || 'left', message.double || false);
                break;

            case 'mousedown':
                input.moveMouse(message.x, message.y);
                input.mouseDown(message.button || 'left');
                break;

            case 'mouseup':
                input.mouseUp(message.button || 'left');
                break;

            case 'scroll':
                input.mouseScroll(message.deltaX || 0, message.deltaY || 0);
                break;

            case 'keypress':
                input.keyTap(message.key, message.modifiers || []);
                break;

            case 'type':
                input.typeString(message.text);
                break;

            case 'ping':
                this.send(ws, { type: 'pong', timestamp: Date.now() });
                break;

            default:
                console.log('未知消息类型:', type);
        }
    }

    /**
     * 开始推送画面（二进制模式）
     */
    async startStreaming() {
        if (this.isStreaming) return;

        this.isStreaming = true;
        this.frameCount = 0;
        this.lastFpsTime = Date.now();
        console.log('[推流] 开始 (二进制模式, 目标 30 FPS)');

        const sendFrame = async () => {
            if (!this.isStreaming || this.clients.size === 0) return;

            const startTime = Date.now();

            try {
                const frameBuffer = await captureScreenBuffer();
                if (frameBuffer) {
                    // 二进制直接发送，比 Base64 快 33%
                    this.broadcastBinary(frameBuffer);
                    this.frameCount++;

                    // 每秒输出一次 FPS
                    const now = Date.now();
                    if (now - this.lastFpsTime >= 1000) {
                        const fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
                        console.log(`[推流] ${fps} FPS, 帧大小: ${Math.round(frameBuffer.length / 1024)} KB`);
                        this.frameCount = 0;
                        this.lastFpsTime = now;
                    }
                }
            } catch (error) {
                console.error('推流错误:', error.message);
            }

            // 计算下一帧延迟（补偿处理时间）
            const elapsed = Date.now() - startTime;
            const delay = Math.max(1, this.frameInterval - elapsed);

            if (this.isStreaming) {
                this.streamTimer = setTimeout(sendFrame, delay);
            }
        };

        sendFrame();
    }

    /**
     * 停止推送画面
     */
    stopStreaming() {
        this.isStreaming = false;
        if (this.streamTimer) {
            clearTimeout(this.streamTimer);
            this.streamTimer = null;
        }
        console.log('[推流] 停止');
    }

    /**
     * 发送 JSON 消息给单个客户端
     */
    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * 广播二进制数据给所有客户端
     */
    broadcastBinary(buffer) {
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(buffer);
            }
        });
    }

    /**
     * 广播 JSON 消息给所有客户端
     */
    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    /**
     * 关闭服务
     */
    close() {
        this.stopStreaming();
        this.wss.close();
    }
}

module.exports = WebSocketServer;
