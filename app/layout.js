import './globals.css';

export const metadata = {
    title: 'Text to Speech',
    description: '將文字轉換為語音',
};

export default function RootLayout({ children }) {
    return (
        <html lang="zh-TW">
            <body>{children}</body>
        </html>
    );
}
