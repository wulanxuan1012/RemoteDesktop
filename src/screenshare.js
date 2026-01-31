/**
 * WebRTC 屏幕共享模块
 * 
 * 使用 Puppeteer 启动 Chrome，通过 getDisplayMedia 捕获屏幕，
 * 然后通过 WebRTC 推流到客户端。
 * 
 * 注意：需要本地安装 Chrome 浏览器
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// Chrome 路径（按优先级查找）
const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH
].filter(Boolean);

class ScreenShare {
    constructor(signalingServer) {
        this.signaling = signalingServer;
        this.browser = null;
        this.page = null;
        this.peerConnections = new Map(); // clientId -> RTCPeerConnection info

        // 绑定信令回调
        this.signaling.onOffer = this.handleOffer.bind(this);
        this.signaling.onIceCandidate = this.handleIceCandidate.bind(this);
    }

    /**
     * 查找 Chrome 路径
     */
    findChrome() {
        for (const chromePath of CHROME_PATHS) {
            if (fs.existsSync(chromePath)) {
                return chromePath;
            }
        }
        return null;
    }

    /**
     * 启动 Chrome 和屏幕共享页面
     */
    async start() {
        const chromePath = this.findChrome();
        if (!chromePath) {
            throw new Error('未找到 Chrome 浏览器，请安装 Chrome 或设置 CHROME_PATH 环境变量');
        }

        console.log(`[屏幕共享] 使用 Chrome: ${chromePath}`);

        this.browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false, // 需要显示窗口才能使用 getDisplayMedia
            args: [
                '--auto-select-desktop-capture-source=Entire screen',
                '--enable-usermedia-screen-capturing',
                '--allow-http-screen-capture',
                '--disable-web-security',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            defaultViewport: null
        });

        this.page = await this.browser.newPage();

        // 注入 WebRTC 脚本
        await this.page.setContent(this.getScreenShareHTML());

        // 暴露 Node.js 函数给页面
        await this.page.exposeFunction('sendIceCandidate', (clientId, candidate) => {
            this.signaling.sendIceCandidate(clientId, candidate);
        });

        await this.page.exposeFunction('log', (msg) => {
            console.log(`[屏幕共享] ${msg}`);
        });

        // 启动屏幕捕获
        const started = await this.page.evaluate(async () => {
            try {
                await window.startCapture();
                return true;
            } catch (e) {
                console.error('启动屏幕捕获失败:', e);
                return false;
            }
        });

        if (started) {
            console.log('[屏幕共享] 屏幕捕获已启动');
        } else {
            console.error('[屏幕共享] 屏幕捕获启动失败');
        }
    }

    /**
     * 处理客户端 Offer
     */
    async handleOffer(clientId, sdp) {
        try {
            const answer = await this.page.evaluate(async (clientId, sdp) => {
                return await window.handleOffer(clientId, sdp);
            }, clientId, sdp);

            return answer;
        } catch (error) {
            console.error('[屏幕共享] 处理 Offer 失败:', error.message);
            return null;
        }
    }

    /**
     * 处理客户端 ICE Candidate
     */
    async handleIceCandidate(clientId, candidate) {
        try {
            await this.page.evaluate(async (clientId, candidate) => {
                await window.handleIceCandidate(clientId, candidate);
            }, clientId, candidate);
        } catch (error) {
            console.error('[屏幕共享] 处理 ICE Candidate 失败:', error.message);
        }
    }

    /**
     * 生成屏幕共享页面 HTML
     */
    getScreenShareHTML() {
        return `
<!DOCTYPE html>
<html>
<head>
  <title>Screen Share Host</title>
</head>
<body>
  <h1>Screen Share Host</h1>
  <video id="preview" autoplay muted style="width: 400px;"></video>
  <script>
    let mediaStream = null;
    const peerConnections = new Map();
    
    // 启动屏幕捕获
    window.startCapture = async function() {
      try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60, max: 60 }
          },
          audio: false
        });
        
        document.getElementById('preview').srcObject = mediaStream;
        window.log('屏幕捕获成功');
        return true;
      } catch (e) {
        window.log('屏幕捕获失败: ' + e.message);
        return false;
      }
    };
    
    // 处理 Offer
    window.handleOffer = async function(clientId, sdp) {
      if (!mediaStream) {
        window.log('错误: 没有媒体流');
        return null;
      }
      
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });
      
      peerConnections.set(clientId, pc);
      
      // 添加媒体轨道
      mediaStream.getTracks().forEach(track => {
        pc.addTrack(track, mediaStream);
      });
      
      // ICE Candidate 事件
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          window.sendIceCandidate(clientId, event.candidate);
        }
      };
      
      // 连接状态
      pc.onconnectionstatechange = () => {
        window.log('连接状态 [' + clientId + ']: ' + pc.connectionState);
      };
      
      // 设置远程描述
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      
      // 创建应答
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      window.log('创建 Answer 成功 [' + clientId + ']');
      return answer.sdp;
    };
    
    // 处理 ICE Candidate
    window.handleIceCandidate = async function(clientId, candidate) {
      const pc = peerConnections.get(clientId);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };
  </script>
</body>
</html>
    `;
    }

    /**
     * 停止屏幕共享
     */
    async stop() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}

module.exports = ScreenShare;
