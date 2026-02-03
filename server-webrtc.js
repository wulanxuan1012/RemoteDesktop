/**
 * 远程桌面服务 - WebRTC 版本
 * 
 * 支持 HTTP 和 HTTPS 双模式
 * 使用浏览器原生 getDisplayMedia 进行屏幕共享
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { getLocalIP } = require('./src/utils');
const input = require('./src/input');
const auth = require('./src/auth');

const PORT = 3000;
const HTTPS_PORT = 3443;

// 检查 SSL 证书是否存在
const certPath = path.join(__dirname, 'certs', 'server.crt');
const keyPath = path.join(__dirname, 'certs', 'server.key');
const hasSSL = fs.existsSync(certPath) && fs.existsSync(keyPath);

const app = express();
app.use(express.json());

// 获取客户端 IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
}

// 从 Cookie 获取 Token
function getTokenFromCookie(req) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/auth_token=([^;]+)/);
    return match ? match[1] : null;
}

// 认证中间件
function requireAuth(req, res, next) {
    const token = getTokenFromCookie(req);
    if (auth.validateSession(token)) {
        next();
    } else {
        res.redirect('/login.html');
    }
}

// 默认页面 - 重定向到登录
app.get('/', (req, res) => {
    const token = getTokenFromCookie(req);
    if (auth.validateSession(token)) {
        res.redirect('/viewer.html');
    } else {
        res.redirect('/login.html');
    }
});

// 登录页面
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 控制页面 - 需要认证
app.get('/viewer.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Client JS - 需要认证
app.get('/client-webrtc.js', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client-webrtc.js'));
});

// 静态文件服务（放在受保护路由之后）
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 认证 API
app.post('/api/auth', (req, res) => {
    const { pin } = req.body;
    const clientIP = getClientIP(req);

    console.log(`[认证] 收到验证请求: IP=${clientIP}, PIN=${pin ? pin.substring(0, 2) + '****' : 'undefined'}`);

    const result = auth.verifyPin(pin, clientIP);

    if (result.success) {
        const token = auth.createSession(clientIP);
        console.log(`[认证] 验证成功: ${clientIP}`);
        res.json({ success: true, token });
    } else {
        console.log(`[认证] 验证失败: ${clientIP}, 原因: ${result.error}`);
        res.status(401).json({
            success: false,
            error: result.error,
            remainingAttempts: result.remainingAttempts
        });
    }
});

// 检查认证状态
app.get('/api/auth/check', (req, res) => {
    const token = getTokenFromCookie(req);
    res.json({ authenticated: auth.validateSession(token) });
});

// 登出
app.post('/api/auth/logout', (req, res) => {
    const token = getTokenFromCookie(req);
    if (token) {
        auth.removeSession(token);
        console.log(`[认证] 用户登出: ${getClientIP(req)}`);
    }
    res.json({ success: true });
});

// 获取当前 PIN（仅限主机页面使用）
app.get('/api/auth/pin', (req, res) => {
    const clientIP = getClientIP(req);
    // 只允许本机访问
    if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1') {
        res.json({ pin: auth.getCurrentPin() });
    } else {
        res.status(403).json({ error: '仅限本机访问' });
    }
});

// 创建 HTTP 服务器
const httpServer = http.createServer(app);

// 创建 HTTPS 服务器（如果有证书）
let httpsServer = null;
if (hasSSL) {
    const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
    httpsServer = https.createServer(sslOptions, app);
}

// WebSocket 服务器（同时支持 HTTP 和 HTTPS）
const wss = new WebSocket.Server({ noServer: true });

// 处理 WebSocket 升级请求
function handleUpgrade(request, socket, head) {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
}

httpServer.on('upgrade', handleUpgrade);
if (httpsServer) {
    httpsServer.on('upgrade', handleUpgrade);
}

// 存储连接
let hostConnection = null;  // 电脑端（分享屏幕的）
const viewerConnections = new Set();  // 手机端（观看的）

// 检查是否为本机 IP
function isLocalIP(ip) {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    // 本机连接（Host）免验证，远程连接需要验证 Token
    if (!isLocalIP(clientIP)) {
        if (!token || !auth.validateSession(token)) {
            console.log(`[拒绝] 未授权连接: ${clientIP}`);
            ws.close(4001, 'Unauthorized');
            return;
        }
    }

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
        } else if (viewerConnections.has(ws)) {
            // 是观看者断开，通知 Host
            if (hostConnection) {
                hostConnection.send(JSON.stringify({
                    type: 'notification',
                    level: 'warning',
                    message: `设备已断开: ${clientIP}`
                }));
            }
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

            // 通知 Host 有新连接
            if (hostConnection) {
                hostConnection.send(JSON.stringify({
                    type: 'notification',
                    level: 'info',
                    message: `新设备已连接: ${clientIP}`
                }));
            }
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

// 启动服务器
httpServer.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    const pin = auth.generatePin();

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   🖥️  远程桌面服务已启动 (WebRTC 模式)    ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║                                          ║');
    console.log(`║   🔐 访问 PIN:  ${pin}                     ║`);
    console.log('║                                          ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║   步骤 1: 在电脑浏览器打开:               ║');
    console.log(`║           http://localhost:${PORT}/host.html`);
    console.log('║                                          ║');
    console.log('║   步骤 2: 点击"开始共享"按钮             ║');
    console.log('║                                          ║');
    console.log('║   步骤 3: 手机浏览器访问:                 ║');
    if (hasSSL) {
        console.log(`║   [HTTP]  http://${localIP}:${PORT}`);
        console.log(`║   [HTTPS] https://${localIP}:${HTTPS_PORT}`);
    } else {
        console.log(`║           http://${localIP}:${PORT}`);
    }
    console.log('║                                          ║');
    console.log('║   步骤 4: 输入上方 PIN 码进行验证        ║');
    console.log('║                                          ║');
    if (hasSSL) {
        console.log('║   💡 推荐使用 HTTPS 以增强安全性        ║');
        console.log('║      (首次需接受自签名证书警告)         ║');
        console.log('║                                          ║');
    }
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
});

// 启动 HTTPS 服务器（带错误处理）
if (httpsServer) {
    httpsServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[HTTPS] ⚠️ 端口 ${HTTPS_PORT} 被占用，HTTPS 服务未启动`);
        } else {
            console.log(`[HTTPS] ⚠️ 启动失败: ${err.message}`);
        }
        // 不影响 HTTP 服务，继续运行
    });

    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`[HTTPS] 安全服务已启动: https://localhost:${HTTPS_PORT}`);
    });
}

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务...');
    wss.close();
    httpServer.close(() => {
        if (httpsServer) {
            httpsServer.close(() => {
                console.log('服务已关闭');
                process.exit(0);
            });
        } else {
            console.log('服务已关闭');
            process.exit(0);
        }
    });
});
