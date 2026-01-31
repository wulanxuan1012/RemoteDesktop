/**
 * 远程桌面服务 - 主入口
 * 
 * 功能：
 * 1. 提供 HTTP 静态文件服务
 * 2. 提供 WebSocket 实时通信
 * 3. 持续推送屏幕画面
 * 4. 接收并执行控制指令
 */

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocketServer = require('./src/websocket');
const { getLocalIP } = require('./src/utils');

// 配置
const PORT = 3000;
const FRAME_INTERVAL = 33; // 每 33ms 一帧 (约 30 FPS)

// 创建 Express 应用
const app = express();

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 创建 HTTP 服务器
const server = http.createServer(app);

// 初始化 WebSocket 服务
const wsServer = new WebSocketServer(server, FRAME_INTERVAL);

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('========================================');
  console.log('   远程桌面服务已启动！');
  console.log('========================================');
  console.log(`   本机访问: http://localhost:${PORT}`);
  console.log(`   手机访问: http://${localIP}:${PORT}`);
  console.log('========================================');
  console.log('   提示: 请确保手机和电脑在同一WiFi下');
  console.log('========================================');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  wsServer.close();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
});
