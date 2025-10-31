/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',  // 啟用靜態匯出
    basePath: '/read.nien.cc',  // GitHub repo 名稱
    images: {
        unoptimized: true,  // 停用圖片優化
    },
}

module.exports = nextConfig
