# 远程桌面系统实现方案文档

## 1. 系统架构概述

本项目采用了一种**混合架构 (Hybrid Architecture)** 来实现高性能的远程桌面控制。它巧妙地结合了浏览器的 WebRTC 能力和 Node.js 的底层控制能力，解决了纯 Node.js 方案在屏幕捕获性能上的瓶颈，同时保留了对操作系统底层的控制权。

### 1.1 核心组件

系统由三个主要部分组成：

1.  **Node.js 服务端 (`server-webrtc.js`)**
    *   **角色**: 信令服务器 (Signaling Server) & 控制指令执行者 (Controller)。
    *   **职责**:
        *   协调 Host 端和 Viewer 端的 WebRTC 连接建立（交换 SDP 和 ICE Candidate）。
        *   接收 Viewer 端的控制指令（鼠标、键盘），并通过 `robotjs` 在宿主机执行。
        *   提供静态文件服务。

2.  **Host 端 (浏览器 - `host.html`)**
    *   **角色**: 视频流源 (Stream Source)。
    *   **职责**:
        *   使用 `navigator.mediaDevices.getDisplayMedia` 捕获当前屏幕或窗口。
        *   建立 WebRTC PeerConnection，将视频流推送到 Viewer 端。
    *   **注意**: 必须在被控电脑的浏览器上运行。

3.  **Viewer 端 (浏览器 - `viewer.html` / `client-webrtc.js`)**
    *   **角色**: 接收端 & 控制端 (Receiver & Controller)。
    *   **职责**:
        *   建立 WebRTC PeerConnection，接收并播放视频流。
        *   捕获用户的交互事件（点击、移动、按键），通过 WebSocket 发送给 Node.js 服务端。

---

## 2. 数据流与工作原理

### 2.1 视频流链路 (Video Path)
**路径**: `Host Browser` -> `WebRTC (P2P/LAN)` -> `Viewer Browser`

*   视频数据**不经过** Node.js 服务端，最大程度降低了延迟和服务器负载。
*   利用浏览器原生的 H.264/VP8 编码器，性能远优于 Node.js 层面的图片压缩。

### 2.2 控制链路 (Control Path)
**路径**: `Viewer Browser` -> `WebSocket` -> `Node.js Server` -> `RobotJS` -> `OS Input`

*   控制指令不直接发给 Host 浏览器（因为浏览器无法模拟全局系统输入）。
*   Viewer 端捕获的坐标是相对坐标 (0-1)，Node.js 服务端将其映射为屏幕绝对坐标。

### 2.3 信令链路 (Signaling Path)
**路径**: `Host/Viewer` <-> `WebSocket` <-> `Node.js Server`

*   用于交换建立 WebRTC 连接所需的元数据 (Offer, Answer, ICE Candidates)。

---

## 3. 详细交互时序

### 3.1 初始化与连接建立

1.  **启动服务**: 用户在被控电脑运行 `node server-webrtc.js`。
2.  **Host 就绪**: 用户在电脑浏览器打开 `http://localhost:3000/host.html`，点击“开始共享”，获取屏幕流，并向 Server 发送 `register-host`。
3.  **Viewer 接入**: 用户在手机浏览器打开 `http://<IP>:3000`，Client 向 Server 发送 `register-viewer`。

### 3.2 WebRTC 握手 (Signaling)

当 Server 检测到 Host 和 Viewer 都已就绪：

1.  **Viewer 发起**: Viewer 创建 `RTCPeerConnection` (RecvOnly)，创建 Offer，发送 `offer` 消息给 Server。
2.  **Server 转发**: Server 将 `offer` 转发给 Host。
3.  **Host 响应**: Host 收到 Offer，设置 RemoteDescription，添加本地流 (AddTrack)，创建 Answer，发送 `answer` 消息给 Server。
4.  **Server 转发**: Server 将 `answer` 转发给 Viewer。
5.  **Viewer 设置**: Viewer 收到 Answer，设置 RemoteDescription。
6.  **ICE 穿透**: 双方交换 `ice-candidate` 消息（经 Server 中转），打通 P2P 连接。
7.  **流传输**: 连接建立，Viewer 端的 `<video>` 标签开始播放画面。

---

## 4. 关键模块实现

### 4.1 服务端消息路由 (`server-webrtc.js`)

服务端维护两个主要的连接状态：
*   `hostConnection`: 指向 Host 页面的 WebSocket 连接。
*   `viewerConnections`: Set 集合，存储所有 Viewer 页面的连接。

**消息处理逻辑**:
*   如果是 `offer`, `answer`, `ice-candidate`: 根据目标 ID 在 Host 和 Viewer 之间透明转发。
*   如果是 `mousemove`, `click`, `keypress` 等控制指令: **不转发**给 Host 页面，而是直接调用 `src/input.js` 执行系统级模拟。

### 4.2 客户端逻辑 (`client-webrtc.js`)

*   **自动播放策略**: 处理浏览器的 Autoplay Policy，如果自动播放失败，显示“点击播放”遮罩层。
*   **输入坐标映射**:
    ```javascript
    x = (clientX - rect.left) / rect.width;
    y = (clientY - rect.top) / rect.height;
    ```
    发送归一化的 (0, 0) 到 (1, 1) 坐标，适应不同分辨率。
*   **状态管理**: 通过 WebSocket 消息 (`host-ready`, `host-disconnected`) 实时更新 UI 状态。

---

## 5. 协议定义

所有通信通过 WebSocket JSON 消息进行。

### 5.1 信令消息
| 类型 (`type`) | 字段 | 说明 |
| :--- | :--- | :--- |
| `register-host` | - | Host 注册 |
| `register-viewer` | - | Viewer 注册 |
| `host-ready` | - |以此通知 Viewer 可以开始连接 |
| `offer` | `sdp`, `viewerId` | SDP 提议 |
| `answer` | `sdp`, `viewerId` | SDP 应答 |
| `ice-candidate` | `candidate`, `viewerId` | 网络候选地址 |

### 5.2 控制消息 (Viewer -> Server)
| 类型 (`type`) | 字段 | 说明 |
| :--- | :--- | :--- |
| `mousemove` | `x`, `y` | 鼠标移动 (0-1) |
| `click` | `x`, `y`, `button` | 鼠标点击 |
| `keypress` | `key`, `modifiers` | 键盘按键 |
| `type` | `text` | 文本输入 |
| `scroll` | `deltaX`, `deltaY` | 滚轮滚动 |

---

## 6. 优缺点分析

### 优点
*   **高帧率**: 利用浏览器硬件加速编码，轻松达到 30-60 FPS。
*   **低延迟**: WebRTC P2P 传输延迟极低 (< 200ms)。
*   **开发简单**: 屏幕捕获交给了浏览器，无需处理复杂的原生截屏库兼容性。

### 缺点
*   **部署复杂**: 需要用户在被控端手动打开浏览器并授权屏幕共享。
*   **浏览器限制**: 无法捕获某些受保护的内容（如 DRM 视频），且必须保持 Host 页面存活。
*   **依赖 RobotJS**: 需要特定的 Node.js 环境来编译原生模块。
