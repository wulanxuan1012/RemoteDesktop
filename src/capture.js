/**
 * 屏幕捕获模块
 * 
 * 使用 screenshot-desktop 库截取屏幕
 * 优化：低质量 JPEG + 二进制传输
 */

const screenshot = require('screenshot-desktop');

// 截图质量 (1-100)，越低体积越小
const JPEG_QUALITY = 30;

/**
 * 捕获屏幕截图 (返回 Buffer，用于二进制传输)
 * @returns {Promise<Buffer>} JPEG 图片 Buffer
 */
async function captureScreenBuffer() {
    try {
        const imgBuffer = await screenshot({ format: 'jpg' });
        return imgBuffer;
    } catch (error) {
        console.error('截图失败:', error.message);
        return null;
    }
}

/**
 * 捕获屏幕截图 (返回 Base64，兼容旧版)
 * @returns {Promise<string>} Base64 编码的图片数据
 */
async function captureScreen() {
    try {
        const imgBuffer = await screenshot({ format: 'jpg' });
        const base64 = imgBuffer.toString('base64');
        return `data:image/jpeg;base64,${base64}`;
    } catch (error) {
        console.error('截图失败:', error.message);
        return null;
    }
}

/**
 * 获取屏幕尺寸
 * @returns {Object} { width, height }
 */
function getScreenSize() {
    try {
        const robot = require('robotjs');
        const size = robot.getScreenSize();
        return size;
    } catch (error) {
        return { width: 1920, height: 1080 };
    }
}

module.exports = {
    captureScreen,
    captureScreenBuffer,
    getScreenSize
};
