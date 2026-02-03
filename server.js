/**
 * 远程桌面服务 - 主入口 (WebSocket 截图模式)
 * 
 * 功能：
 * 1. 提供 HTTP/HTTPS 静态文件服务
 * 2. 提供 WebSocket/WSS 实时通信
 * 3. 持续推送屏幕画面
 * 4. 接收并执行控制指令
 * 5. PIN 码认证
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocketServer = require('./src/websocket');
const { getLocalIP } = require('./src/utils');
const auth = require('./src/auth');

// 配置
const PORT = 3000;
const HTTPS_PORT = 3443;
const FRAME_INTERVAL = 33; // 每 33ms 一帧 (约 30 FPS)

// 检查 SSL 证书是否存在
const certPath = path.join(__dirname, 'certs', 'server.crt');
const keyPath = path.join(__dirname, 'certs', 'server.key');
const hasSSL = fs.existsSync(certPath) && fs.existsSync(keyPath);

// 创建 Express 应用
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

// 默认页面 - 重定向到登录或控制页
app.get('/', (req, res) => {
  const token = getTokenFromCookie(req);
  if (auth.validateSession(token)) {
    res.redirect('/index.html');
  } else {
    res.redirect('/login.html');
  }
});

// 登录页面
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 控制页面 - 需要认证
app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Client JS - 需要认证
app.get('/client.js', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.js'));
});

// 静态文件服务（放在受保护路由之后）
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 认证 API
app.post('/api/auth', (req, res) => {
  const { pin } = req.body;
  const clientIP = getClientIP(req);

  const result = auth.verifyPin(pin, clientIP);

  if (result.success) {
    const token = auth.createSession(clientIP);
    res.json({ success: true, token });
  } else {
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

// 获取当前 PIN（仅限本机访问）
app.get('/api/auth/pin', (req, res) => {
  const clientIP = getClientIP(req);
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

// 初始化 WebSocket 服务
const wsServer = new WebSocketServer(httpServer, FRAME_INTERVAL);
let wssServer = null;
if (httpsServer) {
  wssServer = new WebSocketServer(httpsServer, FRAME_INTERVAL);
}

// 启动服务器
httpServer.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  const pin = auth.generatePin();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🖥️  远程桌面服务已启动 (截图模式)       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║                                          ║');
  console.log(`║   🔐 访问 PIN:  ${pin}                     ║`);
  console.log('║                                          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║   本机访问: http://localhost:${PORT}`);
  if (hasSSL) {
    console.log(`║   [HTTP]  http://${localIP}:${PORT}`);
    console.log(`║   [HTTPS] https://${localIP}:${HTTPS_PORT}`);
  } else {
    console.log(`║   手机访问: http://${localIP}:${PORT}`);
  }
  console.log('║                                          ║');
  console.log('║   提示: 请确保手机和电脑在同一WiFi下     ║');
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
  });

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[HTTPS] 安全服务已启动: https://localhost:${HTTPS_PORT}`);
  });
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  wsServer.close();
  if (wssServer) wssServer.close();
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
