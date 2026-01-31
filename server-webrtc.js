/**
 * 远程桌面服务 - WebRTC 版本 (简化版)
 * 
 * 使用浏览器原生 getDisplayMedia 进行屏幕共享
 * 电脑端：打开 http://localhost:3000/host.html 开始共享
 * 手机端：打开 http://电脑IP:3000 观看并控制
 */

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { getLocalIP } = require('./src/utils');
const input = require('./src/input');

const PORT = 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 默认页面 - 手机控制端
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 存储连接
let hostConnection = null;  // 电脑端（分享屏幕的）
const viewerConnections = new Set();  // 手机端（观看的）

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`[连接] 新客户端: ${clientIP}`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message, clientIP);
        } catch (error) {
            console.error('消息解析错误:', error.message);
        }
    });

    ws.on('close', () => {
        console.log(`[断开] 客户端: ${clientIP}`);
        if (ws === hostConnection) {
            hostConnection = null;
            console.log('[主机] 屏幕共享已停止');
            // 通知所有观看者
            broadcast({ type: 'host-disconnected' });
        }
        viewerConnections.delete(ws);
    });
});

function handleMessage(ws, message, clientIP) {
    const { type } = message;

    switch (type) {
        // 电脑端注册为 Host
        case 'register-host':
            hostConnection = ws;
            console.log(`[主机] 已注册: ${clientIP}`);
            ws.send(JSON.stringify({ type: 'registered', role: 'host' }));
            // 通知所有等待的观看者
            broadcast({ type: 'host-ready' });
            break;

        // 手机端注册为 Viewer
        case 'register-viewer':
            viewerConnections.add(ws);
            console.log(`[观看者] 已注册: ${clientIP}`);
            ws.send(JSON.stringify({
                type: 'registered',
                role: 'viewer',
                hostReady: hostConnection !== null
            }));
            break;

        // 信令转发：Viewer -> Host
        case 'offer':
            console.log(`[信令] 收到 Offer from viewer ${getViewerId(ws)}`);
            if (hostConnection) {
                console.log('[信令] 转发 Offer 给 Host');
                hostConnection.send(JSON.stringify({
                    type: 'offer',
                    sdp: message.sdp,
                    viewerId: getViewerId(ws)
                }));
            } else {
                console.log('[信令] 警告: Host 未连接，无法转发 Offer');
            }
            break;

        // 信令转发：Host -> Viewer
        case 'answer':
            console.log(`[信令] 收到 Answer for viewer ${message.viewerId}`);
            const viewer = getViewerById(message.viewerId);
            if (viewer) {
                console.log('[信令] 转发 Answer 给 Viewer');
                viewer.send(JSON.stringify({ type: 'answer', sdp: message.sdp }));
            } else {
                console.log('[信令] 警告: 找不到 Viewer，无法转发 Answer');
            }
            break;

        // ICE Candidate 转发
        case 'ice-candidate':
            if (ws === hostConnection) {
                // Host -> Viewer
                console.log(`[ICE] Host -> Viewer ${message.viewerId}`);
                const targetViewer = getViewerById(message.viewerId);
                if (targetViewer) {
                    targetViewer.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: message.candidate
                    }));
                }
            } else {
                // Viewer -> Host
                console.log(`[ICE] Viewer ${getViewerId(ws)} -> Host`);
                if (hostConnection) {
                    hostConnection.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: message.candidate,
                        viewerId: getViewerId(ws)
                    }));
                }
            }
            break;

        // 控制指令（从 Viewer 转发给 Host 模拟）
        case 'mousemove':
        case 'click':
        case 'mousedown':
        case 'mouseup':
        case 'scroll':
        case 'keypress':
        case 'type':
            handleControlMessage(message);
            break;
    }
}

// 处理控制指令
function handleControlMessage(message) {
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
    }
}

function getViewerId(ws) {
    let id = 0;
    for (const viewer of viewerConnections) {
        if (viewer === ws) return id;
        id++;
    }
    return -1;
}

function getViewerById(id) {
    let i = 0;
    for (const viewer of viewerConnections) {
        if (i === id) return viewer;
        i++;
    }
    return null;
}

function broadcast(data) {
    const message = JSON.stringify(data);
    viewerConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('========================================');
    console.log('   远程桌面服务已启动 (WebRTC 模式)');
    console.log('========================================');
    console.log('');
    console.log('   步骤 1: 在电脑浏览器打开:');
    console.log(`           http://localhost:${PORT}/host.html`);
    console.log('');
    console.log('   步骤 2: 点击"开始共享"按钮');
    console.log('');
    console.log('   步骤 3: 手机浏览器访问:');
    console.log(`           http://${localIP}:${PORT}`);
    console.log('');
    console.log('========================================');
});

process.on('SIGINT', () => {
    console.log('\n正在关闭服务...');
    wss.close();
    server.close(() => {
        console.log('服务已关闭');
        process.exit(0);
    });
});
