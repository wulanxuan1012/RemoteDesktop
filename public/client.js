/**
 * 远程桌面控制 - 客户端脚本
 */

class RemoteDesktopClient {
    constructor() {
        // DOM 元素
        this.canvas = document.getElementById('remote-screen');
        this.ctx = this.canvas.getContext('2d');
        this.statusDot = document.getElementById('status-dot');
        this.statusText = document.getElementById('status-text');
        this.fpsCounter = document.getElementById('fps-counter');
        this.loading = document.getElementById('loading');
        this.keyboard = document.getElementById('virtual-keyboard');
        this.textInput = document.getElementById('text-input');

        // 状态
        this.ws = null;
        this.connected = false;
        this.screenWidth = 1920;
        this.screenHeight = 1080;
        this.frameCount = 0;
        this.lastFpsUpdate = Date.now();
        this.modifiers = { control: false, alt: false, shift: false };
        this.inputMode = 'mouse'; // 'mouse' | 'touch'

        // 初始化
        this.init();
    }

    init() {
        this.connect();
        this.bindEvents();
        this.startFpsCounter();
    }

    /**
     * 连接 WebSocket
     */
    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

        // 从 Cookie 获取认证 Token
        const tokenMatch = document.cookie.match(/auth_token=([^;]+)/);
        const token = tokenMatch ? tokenMatch[1] : '';

        // 将 Token 附加到 WebSocket URL
        const wsUrl = `${protocol}//${location.host}?token=${encodeURIComponent(token)}`;

        this.statusText.textContent = '正在连接...';

        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'blob'; // 接收二进制数据为 Blob

        this.ws.onopen = () => {
            this.connected = true;
            this.statusDot.classList.add('connected');
            this.statusText.textContent = '已连接';
            this.loading.classList.add('hidden');
            console.log('WebSocket 已连接');
        };

        this.ws.onmessage = (event) => {
            // 二进制数据（图片帧）
            if (event.data instanceof Blob) {
                this.renderBinaryFrame(event.data);
                return;
            }

            // JSON 消息
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error('消息解析错误:', error);
            }
        };

        this.ws.onclose = () => {
            this.connected = false;
            this.statusDot.classList.remove('connected');
            this.statusText.textContent = '连接断开，3秒后重连...';
            this.loading.classList.remove('hidden');
            console.log('WebSocket 已断开');

            // 3秒后重连
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket 错误:', error);
            this.statusText.textContent = '连接错误';
        };
    }

    /**
     * 处理服务端消息
     */
    handleMessage(message) {
        switch (message.type) {
            case 'init':
                this.screenWidth = message.screenWidth;
                this.screenHeight = message.screenHeight;
                console.log(`屏幕尺寸: ${this.screenWidth}x${this.screenHeight}`);
                break;

            case 'frame':
                this.renderFrame(message.data);
                break;

            case 'pong':
                const latency = Date.now() - message.timestamp;
                console.log(`延迟: ${latency}ms`);
                break;
        }
    }

    /**
     * 渲染画面帧 (Base64 格式，兼容旧版)
     */
    renderFrame(dataUrl) {
        const img = new Image();
        img.onload = () => {
            if (this.canvas.width !== img.width || this.canvas.height !== img.height) {
                this.canvas.width = img.width;
                this.canvas.height = img.height;
            }
            this.ctx.drawImage(img, 0, 0);
            this.frameCount++;
        };
        img.src = dataUrl;
    }

    /**
     * 渲染二进制帧 (Blob 格式，高性能)
     */
    renderBinaryFrame(blob) {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            if (this.canvas.width !== img.width || this.canvas.height !== img.height) {
                this.canvas.width = img.width;
                this.canvas.height = img.height;
            }
            this.ctx.drawImage(img, 0, 0);
            this.frameCount++;
            URL.revokeObjectURL(url); // 释放内存
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // Canvas 触摸/点击事件
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e, 'start'));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouch(e, 'move'));
        this.canvas.addEventListener('touchend', (e) => this.handleTouch(e, 'end'));

        // 鼠标事件 (用于电脑调试)
        this.canvas.addEventListener('mousedown', (e) => this.handleMouse(e, 'down'));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouse(e, 'move'));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouse(e, 'up'));
        this.canvas.addEventListener('click', (e) => this.handleClick(e));

        // 工具栏按钮
        document.getElementById('btn-keyboard').addEventListener('click', () => this.toggleKeyboard());
        document.getElementById('btn-mouse').addEventListener('click', () => this.setInputMode('mouse'));
        document.getElementById('btn-touch').addEventListener('click', () => this.setInputMode('touch'));
        document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());

        // 虚拟键盘
        document.getElementById('btn-send-text').addEventListener('click', () => this.sendText());
        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('click', () => this.handleKeyButton(btn));
        });

        // 阻止默认行为
        document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    /**
     * 获取相对坐标
     */
    getRelativePosition(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }

    /**
     * 处理触摸事件
     */
    handleTouch(event, phase) {
        event.preventDefault();

        if (event.touches.length === 0 && phase !== 'end') return;

        const touch = phase === 'end' ? event.changedTouches[0] : event.touches[0];
        const pos = this.getRelativePosition(touch.clientX, touch.clientY);

        switch (phase) {
            case 'start':
                this.touchStartTime = Date.now();
                this.touchStartPos = pos;
                this.send({ type: 'mousemove', x: pos.x, y: pos.y });
                break;

            case 'move':
                this.send({ type: 'mousemove', x: pos.x, y: pos.y });
                break;

            case 'end':
                const duration = Date.now() - this.touchStartTime;
                const distance = Math.sqrt(
                    Math.pow(pos.x - this.touchStartPos.x, 2) +
                    Math.pow(pos.y - this.touchStartPos.y, 2)
                );

                // 短时间内的轻触视为点击
                if (duration < 300 && distance < 0.02) {
                    this.send({ type: 'click', x: pos.x, y: pos.y, button: 'left' });
                }
                break;
        }
    }

    /**
     * 处理鼠标事件 (电脑调试用)
     */
    handleMouse(event, phase) {
        const pos = this.getRelativePosition(event.clientX, event.clientY);

        switch (phase) {
            case 'move':
                if (event.buttons === 1) {
                    this.send({ type: 'mousemove', x: pos.x, y: pos.y });
                }
                break;
        }
    }

    /**
     * 处理点击事件
     */
    handleClick(event) {
        const pos = this.getRelativePosition(event.clientX, event.clientY);
        this.send({ type: 'click', x: pos.x, y: pos.y, button: 'left' });
    }

    /**
     * 切换键盘显示
     */
    toggleKeyboard() {
        this.keyboard.classList.toggle('hidden');
        const btn = document.getElementById('btn-keyboard');
        btn.classList.toggle('active');
    }

    /**
     * 设置输入模式
     */
    setInputMode(mode) {
        this.inputMode = mode;
        document.querySelectorAll('#btn-mouse, #btn-touch').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`btn-${mode}`).classList.add('active');
    }

    /**
     * 切换全屏
     */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(console.error);
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * 发送文本
     */
    sendText() {
        const text = this.textInput.value;
        if (text) {
            this.send({ type: 'type', text });
            this.textInput.value = '';
        }
    }

    /**
     * 处理虚拟键盘按钮
     */
    handleKeyButton(btn) {
        const key = btn.dataset.key;

        // 修饰键处理
        if (btn.classList.contains('modifier')) {
            this.modifiers[key] = !this.modifiers[key];
            btn.classList.toggle('active', this.modifiers[key]);
            return;
        }

        // 普通按键
        const activeModifiers = Object.entries(this.modifiers)
            .filter(([_, active]) => active)
            .map(([mod, _]) => mod);

        this.send({ type: 'keypress', key, modifiers: activeModifiers });

        // 清除修饰键状态
        Object.keys(this.modifiers).forEach(mod => {
            this.modifiers[mod] = false;
        });
        document.querySelectorAll('.key-btn.modifier').forEach(btn => btn.classList.remove('active'));
    }

    /**
     * 发送消息到服务端
     */
    send(data) {
        if (this.connected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * FPS 计数器
     */
    startFpsCounter() {
        setInterval(() => {
            const now = Date.now();
            const elapsed = (now - this.lastFpsUpdate) / 1000;
            const fps = Math.round(this.frameCount / elapsed);
            this.fpsCounter.textContent = `${fps} FPS`;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }, 1000);
    }
}

// 启动客户端
document.addEventListener('DOMContentLoaded', () => {
    new RemoteDesktopClient();
});
