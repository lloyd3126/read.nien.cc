/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',  // 啟用靜態匯出
    // basePath 不需要設定，因為 GitHub Pages 會自動處理 /{repo-name}/ 路徑
    images: {
        unoptimized: true,  // 停用圖片優化
    },
}

module.exports = nextConfig
