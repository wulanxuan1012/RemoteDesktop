/**
 * WebRTC 信令服务器
 * 
 * 处理 WebRTC 连接建立所需的信令交换：
 * - SDP Offer/Answer 交换
 * - ICE Candidate 交换
 */

const WebSocket = require('ws');
const input = require('./input');

class SignalingServer {
    constructor(httpServer) {
        this.wss = new WebSocket.Server({ server: httpServer });
        this.clients = new Map(); // clientId -> { ws, pc }
        this.screenStream = null;
        this.onScreenRequest = null; // 回调函数，请求屏幕共享

        this.init();
    }

    init() {
        this.wss.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            const clientIP = req.socket.remoteAddress;

            console.log(`[信令] 新客户端连接: ${clientId} (${clientIP})`);

            this.clients.set(clientId, { ws, pc: null });

            // 发送客户端 ID 和屏幕信息
            const screenSize = input.getScreenSize();
            this.send(ws, {
                type: 'welcome',
                clientId,
                screenWidth: screenSize.width,
                screenHeight: screenSize.height
            });

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    await this.handleMessage(clientId, message);
                } catch (error) {
                    console.error('[信令] 消息处理错误:', error.message);
                }
            });

            ws.on('close', () => {
                console.log(`[信令] 客户端断开: ${clientId}`);
                this.clients.delete(clientId);
            });

            ws.on('error', (error) => {
                console.error('[信令] WebSocket 错误:', error.message);
                this.clients.delete(clientId);
            });
        });

        console.log('[信令] 服务已启动');
    }

    /**
     * 处理信令消息
     */
    async handleMessage(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        const { type } = message;

        switch (type) {
            // WebRTC 信令
            case 'offer':
                console.log(`[信令] 收到 Offer: ${clientId}`);
                // 转发给屏幕共享处理器
                if (this.onOffer) {
                    const answer = await this.onOffer(clientId, message.sdp);
                    if (answer) {
                        this.send(client.ws, { type: 'answer', sdp: answer });
                    }
                }
                break;

            case 'ice-candidate':
                if (this.onIceCandidate) {
                    this.onIceCandidate(clientId, message.candidate);
                }
                break;

            // 控制指令
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
                this.send(client.ws, { type: 'pong', timestamp: Date.now() });
                break;

            default:
                console.log('[信令] 未知消息类型:', type);
        }
    }

    /**
     * 发送 ICE Candidate 给客户端
     */
    sendIceCandidate(clientId, candidate) {
        const client = this.clients.get(clientId);
        if (client) {
            this.send(client.ws, { type: 'ice-candidate', candidate });
        }
    }

    /**
     * 发送消息
     */
    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * 生成客户端 ID
     */
    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 关闭服务
     */
    close() {
        this.wss.close();
    }
}

module.exports = SignalingServer;
