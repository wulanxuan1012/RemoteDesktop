/**
 * 生成自签名 SSL 证书
 * 使用 node-forge 库
 */

const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const certsDir = path.join(__dirname, 'certs');
const keyPath = path.join(certsDir, 'server.key');
const certPath = path.join(certsDir, 'server.crt');

// 确保目录存在
if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
}

// 如果证书已存在，跳过生成
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('✅ 证书已存在');
    console.log(`   密钥: ${keyPath}`);
    console.log(`   证书: ${certPath}`);
    process.exit(0);
}

console.log('正在生成自签名 SSL 证书...');

// 生成密钥对
const keys = forge.pki.rsa.generateKeyPair(2048);

// 创建证书
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
    { name: 'commonName', value: 'RemoteDesktop' },
    { name: 'countryName', value: 'CN' },
    { name: 'organizationName', value: 'Local Development' }
];

cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    {
        name: 'subjectAltName', altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' }
        ]
    }
]);

// 自签名
cert.sign(keys.privateKey, forge.md.sha256.create());

// 转换为 PEM 格式
const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
const pemCert = forge.pki.certificateToPem(cert);

// 写入文件
fs.writeFileSync(keyPath, pemKey);
fs.writeFileSync(certPath, pemCert);

console.log('');
console.log('✅ 证书生成成功！');
console.log(`   密钥: ${keyPath}`);
console.log(`   证书: ${certPath}`);
console.log('');
console.log('⚠️  注意: 这是自签名证书，浏览器会显示安全警告');
console.log('   首次访问时需要点击「高级」→「继续访问」');
