# 远程桌面工具 - 技术设计文档

## 项目概述

一款轻量级远程桌面工具，支持通过手机浏览器控制 Windows 电脑，适用于局域网环境。

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Windows 电脑 (被控端)                      │
│  ┌────────────────────────────────────────────────────────┐│
│  │                  Node.js 服务                          ││
│  │  ┌────────────┐ ┌────────────┐ ┌─────────────────────┐││
│  │  │ 屏幕捕获   │ │ 输入模拟   │ │  Express + WS 服务  │││
│  │  │ screenshot │ │  robotjs   │ │  端口 3000          │││
│  │  └────────────┘ └────────────┘ └─────────────────────┘││
│  └────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────┘
                           │ 局域网 WiFi
┌──────────────────────────▼──────────────────────────────────┐
│                      手机 (控制端)                           │
│  ┌────────────────────────────────────────────────────────┐│
│  │                    手机浏览器                          ││
│  │   http://电脑IP:3000                                   ││
│  │  ┌──────────────────────────────────────────────────┐ ││
│  │  │ Canvas 渲染 + 触摸事件 + WebSocket 通信          │ ││
│  │  └──────────────────────────────────────────────────┘ ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 技术栈

### 后端 (Node.js)

| 技术 | 版本 | 用途 |
|-----|------|------|
| **Node.js** | ≥18.0 | 运行时环境 |
| **Express.js** | 4.18.2 | HTTP 服务器，静态文件托管 |
| **ws** | 8.14.2 | WebSocket 服务端，实时双向通信 |
| **screenshot-desktop** | 1.15.0 | 跨平台屏幕截图 |
| **robotjs** | 0.6.0 | 键盘鼠标模拟 |

### 前端 (纯原生)

| 技术 | 用途 |
|-----|------|
| **HTML5** | 页面结构 |
| **CSS3** | 样式，深色主题 |
| **JavaScript (ES6+)** | 交互逻辑 |
| **Canvas API** | 画面渲染 |
| **WebSocket API** | 实时通信 |
| **Touch Events** | 触摸操作处理 |

---

## 核心模块设计

### 1. 屏幕捕获 (`src/capture.js`)

```javascript
// 使用 screenshot-desktop 截取屏幕
const imgBuffer = await screenshot({ format: 'jpg' });
// 转换为 Base64 用于 WebSocket 传输
const base64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
```

**技术要点**：
- 截图格式：JPEG（体积小，传输快）
- 默认质量：50%（可调）
- 帧率：10 FPS（100ms 间隔）

### 2. 输入模拟 (`src/input.js`)

```javascript
// 使用 robotjs 模拟输入
robot.moveMouse(x, y);      // 移动鼠标
robot.mouseClick('left');    // 点击
robot.keyTap('enter');       // 按键
robot.typeString('hello');   // 输入文本
```

**技术要点**：
- 坐标转换：相对坐标 (0-1) → 绝对像素坐标
- 支持操作：移动、点击、双击、拖拽、滚动、按键、输入文本

### 3. WebSocket 通信 (`src/websocket.js`)

**服务端 → 客户端**：
```json
{ "type": "frame", "data": "data:image/jpeg;base64,..." }
```

**客户端 → 服务端**：
```json
{ "type": "click", "x": 0.5, "y": 0.3, "button": "left" }
{ "type": "keypress", "key": "enter", "modifiers": ["control"] }
```

**技术要点**：
- 使用 JSON 格式序列化消息
- 坐标使用 0-1 的相对值，兼容不同分辨率
- 支持连接状态管理和自动重连

### 4. 客户端页面 (`public/`)

**画面渲染**：
```javascript
const img = new Image();
img.onload = () => {
  ctx.drawImage(img, 0, 0);
};
img.src = frameDataUrl;
```

**触摸处理**：
```javascript
canvas.addEventListener('touchstart', handleTouch);
canvas.addEventListener('touchmove', handleTouch);
canvas.addEventListener('touchend', handleTouch);
```

---

## 通信协议

### 消息类型

| 类型 | 方向 | 说明 |
|-----|------|------|
| `init` | S→C | 初始化，发送屏幕尺寸 |
| `frame` | S→C | 屏幕画面帧 |
| `mousemove` | C→S | 鼠标移动 |
| `click` | C→S | 鼠标点击 |
| `mousedown` | C→S | 鼠标按下 |
| `mouseup` | C→S | 鼠标释放 |
| `scroll` | C→S | 鼠标滚动 |
| `keypress` | C→S | 键盘按键 |
| `type` | C→S | 输入文本 |
| `ping/pong` | 双向 | 心跳检测 |

---

## 项目结构

```
RemoteDesktop/
├── package.json           # 项目配置和依赖
├── server.js              # 主入口，启动服务
├── src/
│   ├── capture.js         # 屏幕捕获模块
│   ├── input.js           # 输入模拟模块
│   ├── websocket.js       # WebSocket 服务
│   └── utils.js           # 工具函数
└── public/
    ├── index.html         # 控制页面
    ├── style.css          # 样式（深色主题）
    └── client.js          # 客户端脚本
```

---

## 性能优化策略

| 优化项 | 方案 |
|-------|------|
| 图片压缩 | JPEG 质量 50%，减少传输体积 |
| 帧率控制 | 默认 10 FPS，按需调整 |
| 按需推流 | 无客户端连接时停止截图 |
| 坐标相对化 | 使用 0-1 相对值，减少数据量 |

---

## 安全考虑

1. **网络隔离**：仅监听局域网，不暴露公网
2. **访问控制**：可扩展密码认证
3. **加密传输**：可升级为 HTTPS/WSS

---

## 扩展方向

- [ ] WebRTC 替代 WebSocket（更低延迟）
- [ ] H.264 硬件编码（更高帧率）
- [ ] 文件传输功能
- [ ] 剪贴板同步
- [ ] 公网穿透（frp/ngrok）
- [ ] 移动端 APP（React Native）

---

## 运行方式

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 手机浏览器访问
http://<电脑IP>:3000
```

---

## 依赖说明

### robotjs 安装注意

`robotjs` 是原生模块，需要编译环境：

```bash
# Windows 需要安装
npm install -g windows-build-tools
```

如遇安装失败，确保已安装：
- Python 3.x
- Visual Studio Build Tools
