/**
 * 输入模拟模块
 * 
 * 使用 robotjs 模拟键盘和鼠标操作
 */

let robot;
try {
    robot = require('robotjs');
    // 设置鼠标移动速度
    robot.setMouseDelay(1);
    robot.setKeyboardDelay(1);
} catch (error) {
    console.warn('robotjs 加载失败，输入功能将不可用:', error.message);
    robot = null;
}

/**
 * 移动鼠标到指定位置
 * @param {number} x - X 坐标 (0-1 相对值)
 * @param {number} y - Y 坐标 (0-1 相对值)
 */
function moveMouse(x, y) {
    if (!robot) return;

    const screen = robot.getScreenSize();
    const absX = Math.round(x * screen.width);
    const absY = Math.round(y * screen.height);

    robot.moveMouse(absX, absY);
}

/**
 * 鼠标点击
 * @param {number} x - X 坐标 (0-1 相对值)
 * @param {number} y - Y 坐标 (0-1 相对值)
 * @param {string} button - 按键 ('left', 'right', 'middle')
 * @param {boolean} double - 是否双击
 */
function mouseClick(x, y, button = 'left', double = false) {
    if (!robot) return;

    const screen = robot.getScreenSize();
    const absX = Math.round(x * screen.width);
    const absY = Math.round(y * screen.height);

    robot.moveMouse(absX, absY);
    robot.mouseClick(button, double);
}

/**
 * 鼠标按下
 * @param {string} button - 按键
 */
function mouseDown(button = 'left') {
    if (!robot) return;
    robot.mouseToggle('down', button);
}

/**
 * 鼠标释放
 * @param {string} button - 按键
 */
function mouseUp(button = 'left') {
    if (!robot) return;
    robot.mouseToggle('up', button);
}

/**
 * 鼠标滚动
 * @param {number} deltaX - 水平滚动量
 * @param {number} deltaY - 垂直滚动量
 */
function mouseScroll(deltaX, deltaY) {
    if (!robot) return;
    robot.scrollMouse(deltaX, deltaY);
}

/**
 * 键盘按键
 * @param {string} key - 按键名称
 * @param {Array} modifiers - 修饰键 ['control', 'shift', 'alt']
 */
function keyTap(key, modifiers = []) {
    if (!robot) return;

    try {
        robot.keyTap(key, modifiers);
    } catch (error) {
        console.error('按键失败:', key, error.message);
    }
}

/**
 * 输入文本
 * @param {string} text - 要输入的文本
 */
function typeString(text) {
    if (!robot) return;

    try {
        robot.typeString(text);
    } catch (error) {
        console.error('输入文本失败:', error.message);
    }
}

/**
 * 获取屏幕尺寸
 */
function getScreenSize() {
    if (!robot) return { width: 1920, height: 1080 };
    return robot.getScreenSize();
}

module.exports = {
    moveMouse,
    mouseClick,
    mouseDown,
    mouseUp,
    mouseScroll,
    keyTap,
    typeString,
    getScreenSize,
    isAvailable: () => robot !== null
};
