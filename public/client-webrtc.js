/**
 * 远程桌面控制 - WebRTC 客户端
 */

class WebRTCClient {
    constructor() {
        // DOM 元素
        this.video = document.getElementById('remote-video');
        this.statusDot = document.getElementById('status-dot');
        this.statusText = document.getElementById('status-text');
        this.fpsCounter = document.getElementById('fps-counter');
        this.debugPanel = document.getElementById('debug-panel');
        this.playOverlay = document.getElementById('play-overlay');
        this.playMsg = document.getElementById('play-msg');
        this.playDebugInfo = document.getElementById('play-debug-info');
        this.keyboard = document.getElementById('virtual-keyboard');
        this.textInput = document.getElementById('text-input');

        // 状态
        this.ws = null;
        this.pc = null;
        this.clientId = null;
        this.connected = false;
        this.modifiers = { control: false, alt: false, shift: false };
        this.statsInterval = null;

        // 初始化
        this.log('WebRTCClient 初始化 (v2.1)');
        this.init();
    }

    log(msg) {
        console.log(msg);
        if (this.debugPanel) {
            const line = document.createElement('div');
            line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            this.debugPanel.appendChild(line);
            this.debugPanel.scrollTop = this.debugPanel.scrollHeight;
        }

        if (this.playOverlay && !this.playOverlay.classList.contains('hidden') && this.playDebugInfo) {
            this.playDebugInfo.textContent = msg;
        }
    }

    updateStatus(text, color = 'red') {
        if (this.statusText) this.statusText.textContent = text;
        if (this.statusDot) this.statusDot.style.background = color;
        this.log(`状态更新: ${text}`);
    }

    init() {
        this.connect();
        this.bindEvents();
    }

    /**
     * 连接信令服务器
     */
    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

        // 从 Cookie 获取认证 Token
        const tokenMatch = document.cookie.match(/auth_token=([^;]+)/);
        const token = tokenMatch ? tokenMatch[1] : '';

        // 将 Token 附加到 WebSocket URL
        const wsUrl = `${protocol}//${location.host}?token=${encodeURIComponent(token)}`;

        this.log(`连接 WebSocket: ${wsUrl.substring(0, 50)}...`);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.updateStatus('WS已连接', 'orange');
            this.ws.send(JSON.stringify({ type: 'register-viewer' }));
        };

        this.ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                await this.handleSignaling(message);
            } catch (error) {
                this.log(`信令消息错误: ${error} ${event.data}`);
            }
        };

        this.ws.onclose = () => {
            this.updateStatus('WS断开，3秒后重连', 'red');
            this.connected = false;
            if (this.pc) {
                this.pc.close();
                this.pc = null;
            }
            this.stopStats();
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = (error) => {
            this.log('WebSocket 错误');
        };
    }

    /**
     * 处理信令消息
     */
    async handleSignaling(message) {
        switch (message.type) {
            case 'registered':
                this.clientId = message.clientId; // Server might not send this actually
                this.log(`注册成功. HostReady: ${message.hostReady}`);
                if (message.hostReady) {
                    await this.initWebRTC();
                } else {
                    this.updateStatus('等待Host上线...');
                }
                break;

            case 'host-ready':
                this.log('Host上线，开始WebRTC流程');
                await this.initWebRTC();
                break;

            case 'host-disconnected':
                this.log('Host断开');
                this.updateStatus('Host断开', 'red');
                if (this.pc) {
                    this.pc.close();
                    this.pc = null;
                }
                this.stopStats();
                break;

            case 'answer':
                this.log('收到 Answer');
                if (this.pc) {
                    await this.pc.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: message.sdp
                    }));
                }
                break;

            case 'ice-candidate':
                if (this.pc && message.candidate) {
                    this.log(`收到 Host Candidate: ${message.candidate.candidate.substring(0, 20)}...`);
                    await this.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
                }
                break;
        }
    }

    /**
     * 初始化 WebRTC 连接
     */
    async initWebRTC() {
        if (this.pc) {
            this.log('关闭旧 PC 连接');
            this.pc.close();
        }

        this.updateStatus('建立 WebRTC...', 'orange');

        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.log(`创建 RTCPeerConnection, ICE Servers: ${config.iceServers.length}`);
        this.pc = new RTCPeerConnection(config);

        // 接收视频轨道
        this.pc.ontrack = (event) => {
            this.log(`OnTrack: kind=${event.track.kind}, streams=${event.streams.length}`);
            this.video.srcObject = event.streams[0];
            this.log(`设置 video.srcObject. ID: ${event.streams[0].id}`);
            this.tryPlayVideo();
        };

        // ICE Candidate
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.log(`发送 Candidate: ${event.candidate.candidate.substring(0, 20)}...`);
                this.send({ type: 'ice-candidate', candidate: event.candidate });
            } else {
                this.log('ICE Candidate收集完成');
            }
        };

        // 连接状态
        this.pc.onconnectionstatechange = () => {
            this.log(`PC连接状态: ${this.pc.connectionState}`);
        };

        this.pc.oniceconnectionstatechange = () => {
            const state = this.pc.iceConnectionState;
            this.log(`ICE状态变更: ${state}`);
            if (state === 'connected') {
                this.updateStatus('WebRTC已连接', '#2ed573');
                this.startStats();
            } else if (state === 'failed' || state === 'disconnected') {
                this.updateStatus(`WebRTC ${state}`, 'red');
            }
        };

        // 添加收发器（需要接收视频）
        this.pc.addTransceiver('video', { direction: 'recvonly' });

        try {
            // 创建 Offer
            this.log('创建 Offer...');
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            this.log('发送 Offer...');
            this.send({ type: 'offer', sdp: offer.sdp });
        } catch (e) {
            this.log(`WebRTC Error: ${e.message}`);
        }
    }

    async tryPlayVideo() {
        this.log('尝试播放视频...');
        try {
            this.video.muted = true;
            this.video.playsInline = true;
            await this.video.play();
            this.log('视频播放成功');
            if (this.playOverlay) this.playOverlay.classList.add('hidden');
        } catch (e) {
            this.log(`自动播放失败: ${e.name}: ${e.message}`);
            this.showPlayOverlay();
        }
    }

    showPlayOverlay() {
        if (this.playOverlay) {
            this.playOverlay.classList.remove('hidden');
            if (this.playMsg) this.playMsg.textContent = '浏览器限制自动播放，请点击屏幕开始';
        }
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // Play Overlay
        if (this.playOverlay) {
            this.playOverlay.addEventListener('click', () => {
                this.log('用户点击遮罩层，尝试播放');
                this.tryPlayVideo();
            });
        }

        // Debug Toggle
        document.getElementById('status-bar')?.addEventListener('click', () => {
            this.debugPanel?.classList.toggle('visible');
        });
        document.getElementById('btn-debug')?.addEventListener('click', () => {
            this.debugPanel?.classList.toggle('visible');
        });

        // 视频触摸/点击事件
        this.video.addEventListener('touchstart', (e) => this.handleTouch(e, 'start'));
        this.video.addEventListener('touchmove', (e) => this.handleTouch(e, 'move'));
        this.video.addEventListener('touchend', (e) => this.handleTouch(e, 'end'));

        // 鼠标事件
        this.video.addEventListener('click', (e) => this.handleClick(e));
        this.video.addEventListener('mousemove', (e) => {
            if (e.buttons === 1) this.handleMouseMove(e);
        });

        // 通用绑定函数
        const bindBtn = (id, handler) => {
            const el = document.getElementById(id);
            if (el) {
                const wrapper = (e) => {
                    // 防止点击穿透和双重触发
                    if (e.cancelable) e.preventDefault();
                    e.stopPropagation();
                    handler(e);
                };
                el.addEventListener('touchend', wrapper);
                el.addEventListener('click', wrapper);
            }
        };

        // 工具栏按钮
        bindBtn('btn-keyboard', () => this.toggleKeyboard());
        bindBtn('btn-fullscreen', () => this.toggleFullscreen());

        // 虚拟键盘
        bindBtn('btn-send-text', () => this.sendText());
        document.querySelectorAll('.key-btn').forEach(btn => {
            const wrapper = (e) => {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                this.handleKeyButton(btn);
            };
            btn.addEventListener('touchend', wrapper);
            btn.addEventListener('click', wrapper);
        });

        // 阻断调试面板的事件冒泡，防止误触视频
        const debugPanel = document.getElementById('debug-panel');
        if (debugPanel) {
            ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'click'].forEach(evt => {
                debugPanel.addEventListener(evt, (e) => {
                    e.stopPropagation(); // 阻止冒泡到 video 或 document
                    // 不要 preventDefault，否则无法滚动
                }, { passive: false });
            });
        }

        // 阻止默认行为（防止滚动），但允许特定区域交互
        document.addEventListener('touchmove', (e) => {
            if (e.target.closest('#debug-panel') ||
                e.target.closest('#toolbar') ||
                e.target.closest('#virtual-keyboard')) {
                return;
            }
            e.preventDefault();
        }, { passive: false });
    }

    /**
     * 获取相对坐标
     */
    getRelativePosition(clientX, clientY) {
        const rect = this.video.getBoundingClientRect();
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

                if (duration < 300 && distance < 0.02) {
                    this.send({ type: 'click', x: pos.x, y: pos.y, button: 'left' });
                }
                break;
        }
    }

    /**
     * 处理点击
     */
    handleClick(event) {
        const pos = this.getRelativePosition(event.clientX, event.clientY);
        this.send({ type: 'click', x: pos.x, y: pos.y, button: 'left' });
    }

    /**
     * 处理鼠标移动
     */
    handleMouseMove(event) {
        const pos = this.getRelativePosition(event.clientX, event.clientY);
        this.send({ type: 'mousemove', x: pos.x, y: pos.y });
    }

    /**
     * 切换键盘
     */
    toggleKeyboard() {
        if (this.keyboard) this.keyboard.classList.toggle('hidden');
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

        if (btn.classList.contains('modifier')) {
            this.modifiers[key] = !this.modifiers[key];
            btn.classList.toggle('active', this.modifiers[key]);
            return;
        }

        const activeModifiers = Object.entries(this.modifiers)
            .filter(([_, active]) => active)
            .map(([mod, _]) => mod);

        this.send({ type: 'keypress', key, modifiers: activeModifiers });

        Object.keys(this.modifiers).forEach(mod => {
            this.modifiers[mod] = false;
        });
        document.querySelectorAll('.key-btn.modifier').forEach(btn => btn.classList.remove('active'));
    }

    /**
     * 发送消息
     */
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * 统计信息监控
     */
    startStats() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(async () => {
            if (!this.pc) return;

            try {
                const stats = await this.pc.getStats();
                let fps = '--';

                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        fps = report.framesPerSecond || '--';
                    }
                });

                if (this.fpsCounter) this.fpsCounter.textContent = `${Math.round(fps)} FPS`;
            } catch (e) {
                // ignore
            }
        }, 1000);
    }

    stopStats() {
        if (this.statsInterval) clearInterval(this.statsInterval);
    }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
    new WebRTCClient();
});
