'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Settings } from 'lucide-react';

export default function Home() {
    const [text, setText] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [tempApiKey, setTempApiKey] = useState('');
    const [totalLines, setTotalLines] = useState(0);
    const [generatedCount, setGeneratedCount] = useState(0);
    const [playingIndex, setPlayingIndex] = useState(0);
    const audioContextRef = useRef(null);
    const currentAudioRef = useRef(null);
    const isPlayingRef = useRef(false);

    // 初始化 API Key 從 localStorage
    useEffect(() => {
        const stored = localStorage.getItem('GEMINI_API_KEY');
        console.log('[INIT] 從 localStorage 讀取 API Key:', stored ? '✓ 已找到' : '✗ 未找到');
        if (stored) {
            setApiKey(stored);
            setTempApiKey(stored);
        }
    }, []);

    // 保存 API Key
    const handleSaveApiKey = () => {
        console.log('[SETTINGS] 保存 API Key');
        localStorage.setItem('GEMINI_API_KEY', tempApiKey);
        setApiKey(tempApiKey);
        setShowModal(false);
    };

    // 清除 API Key
    const handleClearApiKey = () => {
        console.log('[SETTINGS] 清除 API Key');
        localStorage.removeItem('GEMINI_API_KEY');
        setApiKey('');
        setTempApiKey('');
    };

    // 分割文本為數組（只保留有文字的項目）
    const splitText = (str) => {
        return str
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    };

    // 解析 MIME 類型
    const parseMimeType = (mimeType) => {
        const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
        const [_, format] = fileType.split('/');

        const options = {
            numChannels: 1,
            bitsPerSample: 16,
            sampleRate: 24000,
        };

        if (format && format.startsWith('L')) {
            const bits = parseInt(format.slice(1), 10);
            if (!isNaN(bits)) {
                options.bitsPerSample = bits;
            }
        }

        for (const param of params) {
            const [key, value] = param.split('=').map(s => s.trim());
            if (key === 'rate') {
                options.sampleRate = parseInt(value, 10);
            }
        }

        return options;
    };

    // 創建 WAV 文件頭
    const createWavHeader = (dataLength, options) => {
        const { numChannels, sampleRate, bitsPerSample } = options;
        const byteRate = sampleRate * numChannels * bitsPerSample / 8;
        const blockAlign = numChannels * bitsPerSample / 8;
        const buffer = new ArrayBuffer(44);
        const view = new DataView(buffer);

        // RIFF chunk descriptor
        view.setUint32(0, 0x52494646, false); // "RIFF"
        view.setUint32(4, 36 + dataLength, true); // ChunkSize
        view.setUint32(8, 0x57415645, false); // "WAVE"

        // fmt sub-chunk
        view.setUint32(12, 0x666d7420, false); // "fmt "
        view.setUint32(16, 16, true); // Subchunk1Size (PCM)
        view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
        view.setUint16(22, numChannels, true); // NumChannels
        view.setUint32(24, sampleRate, true); // SampleRate
        view.setUint32(28, byteRate, true); // ByteRate
        view.setUint16(32, blockAlign, true); // BlockAlign
        view.setUint16(34, bitsPerSample, true); // BitsPerSample

        // data sub-chunk
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, dataLength, true); // Subchunk2Size

        return new Uint8Array(buffer);
    };

    // 轉換 PCM 為 WAV
    const convertToWav = (base64Data, mimeType) => {
        console.log('[WAV] 轉換 PCM 為 WAV，MIME:', mimeType);
        const options = parseMimeType(mimeType);
        console.log('[WAV] 音頻參數:', options);

        // 將 base64 轉換為 Uint8Array
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const wavHeader = createWavHeader(bytes.length, options);
        const wavData = new Uint8Array(wavHeader.length + bytes.length);
        wavData.set(wavHeader, 0);
        wavData.set(bytes, wavHeader.length);

        console.log('[WAV] 轉換完成，總大小:', wavData.length);
        return wavData;
    };

    // 轉換單行文字為音檔 Blob
    const textToSpeech = async (text) => {
        console.log('[TTS] 開始轉換文字:', text);

        if (!apiKey) {
            console.error('[TTS] API Key 未設定');
            alert('請先設定 API Key');
            return null;
        }

        try {
            console.log('[TTS] 向 API 發送請求...');
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    model: 'models/gemini-2.5-flash-preview-tts',
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    text: text,
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 1,
                        responseModalities: ['audio'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: 'Zephyr',
                                },
                            },
                        },
                    },
                }),
            });

            console.log('[TTS] API 響應狀態:', response.status);

            if (!response.ok) {
                const error = await response.json();
                console.error('[TTS] API 錯誤回應:', error);
                throw new Error(`API 錯誤: ${response.status}`);
            }

            const data = await response.json();
            console.log('[TTS] API 回應數據:', data);

            // 提取音頻數據
            if (
                data.candidates &&
                data.candidates[0]?.content?.parts?.[0]?.inlineData
            ) {
                const inlineData = data.candidates[0].content.parts[0].inlineData;
                console.log('[TTS] 找到音頻數據，MIME 類型:', inlineData.mimeType);

                // 轉換為 WAV 格式
                const wavData = convertToWav(inlineData.data, inlineData.mimeType);
                console.log('[TTS] 轉換成功，WAV Blob 大小:', wavData.length, 'bytes');
                return new Blob([wavData], { type: 'audio/wav' });
            }

            console.error('[TTS] 未找到音頻數據，完整回應:', data);
            throw new Error('未收到音頻數據');
        } catch (error) {
            console.error('[TTS] 轉換失敗:', error);
            alert(`轉換失敗: ${error.message}`);
            return null;
        }
    };

    // 播放音檔
    const playBlob = (blob, delayAfter = 0) => {
        console.log('[PLAY] 開始播放，Blob 大小:', blob.size, '播放後延遲:', delayAfter, 'ms');
        return new Promise((resolve) => {
            const url = URL.createObjectURL(blob);
            console.log('[PLAY] Blob URL:', url);

            const audio = new Audio(url);
            currentAudioRef.current = audio;

            audio.onended = () => {
                console.log('[PLAY] 播放結束');
                URL.revokeObjectURL(url);

                // 如果有延遲時間，則等待後再 resolve
                if (delayAfter > 0) {
                    console.log('[PLAY] 等待', delayAfter, 'ms...');
                    setTimeout(() => {
                        console.log('[PLAY] 延遲完成，準備播放下一段');
                        resolve();
                    }, delayAfter);
                } else {
                    resolve();
                }
            };

            audio.onerror = (e) => {
                console.error('[PLAY] 播放錯誤:', e);
                URL.revokeObjectURL(url);
                resolve();
            };

            audio.play().catch((err) => {
                console.error('[PLAY] 播放失敗:', err);
                URL.revokeObjectURL(url);
                resolve();
            });
        });
    };

    // 處理播放按鈕
    const handlePlayClick = async () => {
        console.log('[BUTTON] 播放按鈕被點擊，當前狀態:', { isPlaying, apiKey: !!apiKey, text: text.length });

        if (isPlaying) {
            // 停止播放
            console.log('[BUTTON] 停止播放');
            isPlayingRef.current = false;
            if (currentAudioRef.current) {
                currentAudioRef.current.pause();
                currentAudioRef.current = null;
            }
            setIsPlaying(false);
            return;
        }

        if (!text.trim()) {
            console.warn('[BUTTON] 編輯區為空');
            alert('請輸入文字');
            return;
        }

        const lines = splitText(text);
        console.log('[BUTTON] 分割文本:', lines);

        setTotalLines(lines.length);
        setGeneratedCount(0);
        setPlayingIndex(0);
        setIsPlaying(true);
        isPlayingRef.current = true;

        try {
            console.log('[BUTTON] 開始邊生成邊播放語音，每批 5 段...');
            const CONCURRENT_BATCH_SIZE = 5;
            let generatedSoFar = 0;

            for (let i = 0; i < lines.length; i += CONCURRENT_BATCH_SIZE) {
                if (!isPlayingRef.current) {
                    console.log('[BUTTON] 流程已被停止');
                    break;
                }

                const batchEnd = Math.min(i + CONCURRENT_BATCH_SIZE, lines.length);
                const batch = lines.slice(i, batchEnd);
                console.log(`[BUTTON] 第 ${Math.floor(i / CONCURRENT_BATCH_SIZE) + 1} 批：開始並發生成第 ${i + 1}-${batchEnd}/${lines.length} 行（共 ${batch.length} 段）`);

                // 並發生成這一批文本
                const batchPromises = batch.map((line, batchIndex) => {
                    const lineIndex = i + batchIndex;
                    console.log(`[BUTTON] 發起請求：第 ${lineIndex + 1}/${lines.length} 行: ${line}`);
                    return textToSpeech(line)
                        .then((blob) => {
                            if (blob) {
                                console.log(`[BUTTON] 第 ${lineIndex + 1} 行生成完成，大小: ${blob.size} bytes`);
                                generatedSoFar++;
                                setGeneratedCount(generatedSoFar);
                                return { index: lineIndex, blob };
                            } else {
                                console.warn(`[BUTTON] 第 ${lineIndex + 1} 行生成失敗`);
                                generatedSoFar++;
                                setGeneratedCount(generatedSoFar);
                                return { index: lineIndex, blob: null };
                            }
                        })
                        .catch((error) => {
                            console.error(`[BUTTON] 第 ${lineIndex + 1} 行生成錯誤:`, error);
                            generatedSoFar++;
                            setGeneratedCount(generatedSoFar);
                            return { index: lineIndex, blob: null };
                        });
                });

                // 等待這一批全部完成
                const batchResults = await Promise.all(batchPromises);
                console.log(`[BUTTON] 第 ${Math.floor(i / CONCURRENT_BATCH_SIZE) + 1} 批生成完成`);

                // 播放這一批的音頻（按照原始順序）
                console.log(`[BUTTON] 開始播放第 ${Math.floor(i / CONCURRENT_BATCH_SIZE) + 1} 批...`);
                for (const result of batchResults) {
                    if (!isPlayingRef.current) {
                        console.log('[BUTTON] 播放已被停止');
                        return;
                    }

                    if (result.blob) {
                        setPlayingIndex(result.index + 1);
                        const isLastBlob = result.index === lines.length - 1;
                        const delay = isLastBlob ? 0 : 200;
                        console.log(`[BUTTON] 播放第 ${result.index + 1}/${lines.length} 個音檔`);
                        await playBlob(result.blob, delay);
                    } else {
                        console.warn(`[BUTTON] 跳過第 ${result.index + 1} 行（生成失敗）`);
                    }
                }
            }

            console.log('[BUTTON] 所有音檔播放完成');
        } catch (error) {
            console.error('[BUTTON] 播放流程錯誤:', error);
        } finally {
            setIsPlaying(false);
            isPlayingRef.current = false;
        }
    };

    return (
        <div className="!p-10">
            <div className="w-full">
                {/* 標題 */}
                <div className="mb-6 text-center">
                    <h1 className="text-3xl font-bold text-black mb-6">Text to Speech</h1>
                    {/* 按鈕區 */}
                    <div className="flex gap-3 items-center justify-center">
                        {/* 設定按鈕 */}
                        <button
                            onClick={() => {
                                setTempApiKey(apiKey);
                                setShowModal(true);
                            }}
                            className="flex-1 flex justify-center items-center p-3 rounded-lg bg-black text-white transition-colors hover:cursor-pointer"
                            title="設定"
                        >
                            <Settings size={24} />
                        </button>

                        {/* 播放/暫停按鈕 */}
                        <button
                            onClick={handlePlayClick}
                            disabled={!apiKey || !text.trim()}
                            className="flex-1 flex justify-center items-center p-3 rounded-lg bg-black text-white transition-colors disabled:cursor-not-allowed hover:cursor-pointer"
                            style={(!apiKey || !text.trim()) ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                            title={isPlaying ? '暫停' : '播放'}
                        >
                            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                        </button>
                    </div>
                </div>

                {/* 進度顯示 */}
                {isPlaying && (
                    <div className="mb-6 p-4 bg-white rounded-lg border-2 border-black">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center">
                                <div className="text-sm font-medium text-black mb-1">總段落數</div>
                                <div className="text-2xl font-bold text-black">{totalLines}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-sm font-medium text-black mb-1">已經生成</div>
                                <div className="text-2xl font-bold text-black">{generatedCount}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-sm font-medium text-black mb-1">正在播放</div>
                                <div className="text-2xl font-bold text-black">{playingIndex}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 編輯區 */}
                <div className="mb-4">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        disabled={isPlaying}
                        placeholder="在此輸入要轉換的文字，按換行分段..."
                        suppressHydrationWarning
                        rows={10}
                        className={`w-full p-4 rounded-lg border-2 border-black focus:border-black focus:outline-none resize-y transition-all ${isPlaying
                            ? 'cursor-not-allowed text-black'
                            : 'bg-white text-black'
                            }`}
                        style={isPlaying ? { backgroundColor: '#f4f4f4' } : {}}
                    />
                </div>
            </div>

            {/* 設定模態框 */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                        <h2 className="text-2xl font-bold mb-4 text-black">API 金鑰設定</h2>

                        <div className="mb-4 p-3 bg-gray-100 border border-black rounded text-sm text-black">
                            <p className="font-semibold mb-1">⚠️ 重要提示</p>
                            <p>
                                本專案完全在前端運行，沒有後端伺服器。API
                                金鑰僅保存在您的瀏覽器本地儲存中，不會被上傳到任何伺服器。請自行妥善保管。
                            </p>
                        </div>

                        <input
                            type="password"
                            value={tempApiKey}
                            onChange={(e) => setTempApiKey(e.target.value)}
                            placeholder="輸入 Gemini API Key"
                            className="w-full px-4 py-2 border border-black rounded-lg focus:border-black focus:outline-none mb-4 bg-white text-black"
                        />

                        <div className="flex gap-3">
                            <button
                                onClick={handleClearApiKey}
                                className="flex-1 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
                            >
                                清除
                            </button>
                            <button
                                onClick={() => setShowModal(false)}
                                className="flex-1 px-4 py-2 bg-gray-300 text-black rounded-lg hover:bg-gray-400 transition-colors font-medium"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSaveApiKey}
                                className="flex-1 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
