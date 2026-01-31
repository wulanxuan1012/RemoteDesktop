/**
 * 工具函数
 */

const os = require('os');

/**
 * 获取本机局域网 IP 地址
 * 优先选择 192.168.x.x 开头的真实局域网地址
 * @returns {string} IP 地址
 */

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // 跳过 IPv6 和回环地址
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    name: name
                });
            }
        }
    }

    // 优先选择 192.168.x.x（家庭/公司局域网）
    const preferred = candidates.find(c => c.address.startsWith('192.168.'));
    if (preferred) {
        return preferred.address;
    }

    // 其次选择 10.x.x.x（公司网络）
    const secondary = candidates.find(c => c.address.startsWith('10.'));
    if (secondary) {
        return secondary.address;
    }

    // 最后返回第一个可用的
    return candidates.length > 0 ? candidates[0].address : '127.0.0.1';
}

module.exports = {
    getLocalIP
};
