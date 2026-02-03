/**
 * 认证模块
 * 
 * 提供 PIN 码认证和会话管理功能
 */

const crypto = require('crypto');

// 配置
const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 分钟
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 小时

// 状态
let currentPin = null;
let pinHash = null;
const sessions = new Map(); // token -> { createdAt, ip }
const attemptTracker = new Map(); // ip -> { count, lockedUntil }

/**
 * 生成随机 PIN 码
 * @returns {string} 6 位数字 PIN
 */
function generatePin() {
    currentPin = String(Math.floor(100000 + Math.random() * 900000));
    pinHash = hashPin(currentPin);
    return currentPin;
}

/**
 * 获取当前 PIN（用于显示）
 * @returns {string|null}
 */
function getCurrentPin() {
    return currentPin;
}

/**
 * 计算 PIN 的 SHA-256 哈希
 * @param {string} pin 
 * @returns {string}
 */
function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex');
}

/**
 * 验证 PIN 码
 * @param {string} inputPin 用户输入的 PIN
 * @param {string} clientIP 客户端 IP
 * @returns {{ success: boolean, error?: string, remainingAttempts?: number }}
 */
function verifyPin(inputPin, clientIP) {
    // 检查是否被锁定
    const tracker = attemptTracker.get(clientIP);
    if (tracker && tracker.lockedUntil && Date.now() < tracker.lockedUntil) {
        const remainingSeconds = Math.ceil((tracker.lockedUntil - Date.now()) / 1000);
        return {
            success: false,
            error: `已锁定，请 ${remainingSeconds} 秒后重试`,
            locked: true
        };
    }

    // 验证 PIN
    const inputHash = hashPin(inputPin);
    if (inputHash === pinHash) {
        // 清除尝试记录
        attemptTracker.delete(clientIP);
        return { success: true };
    }

    // 记录失败尝试
    const attempts = (tracker?.count || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
        attemptTracker.set(clientIP, {
            count: attempts,
            lockedUntil: Date.now() + LOCKOUT_DURATION
        });
        return {
            success: false,
            error: `错误次数过多，已锁定 5 分钟`,
            locked: true
        };
    }

    attemptTracker.set(clientIP, { count: attempts });
    return {
        success: false,
        error: 'PIN 码错误',
        remainingAttempts: MAX_ATTEMPTS - attempts
    };
}

/**
 * 创建会话 Token
 * @param {string} clientIP
 * @returns {string} 会话 Token
 */
function createSession(clientIP) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
        createdAt: Date.now(),
        ip: clientIP
    });
    return token;
}

/**
 * 验证会话 Token
 * @param {string} token
 * @returns {boolean}
 */
function validateSession(token) {
    if (!token) return false;

    const session = sessions.get(token);
    if (!session) return false;

    // 检查是否过期
    if (Date.now() - session.createdAt > SESSION_DURATION) {
        sessions.delete(token);
        return false;
    }

    return true;
}

/**
 * 清理过期会话
 */
function cleanupSessions() {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now - session.createdAt > SESSION_DURATION) {
            sessions.delete(token);
        }
    }
}

/**
 * 删除指定会话（用于登出）
 * @param {string} token
 * @returns {boolean} 是否成功删除
 */
function removeSession(token) {
    return sessions.delete(token);
}

// 每小时清理一次过期会话
setInterval(cleanupSessions, 60 * 60 * 1000);

module.exports = {
    generatePin,
    getCurrentPin,
    verifyPin,
    createSession,
    validateSession,
    removeSession,
    PIN_LENGTH
};
