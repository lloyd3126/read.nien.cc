'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Settings, BookHeadphones, SquarePen, RotateCcw, Loader2, Download } from 'lucide-react';

export default function Home() {
    const [text, setText] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [tempApiKey, setTempApiKey] = useState('');
    const [viewMode, setViewMode] = useState('edit'); // 'edit', 'read', 'settings'

    // 音檔緩存機制
    const [audioCache, setAudioCache] = useState(new Map()); // Map<lineIndex, blob> - 用於 UI 顯示
    const audioCacheRef = useRef(new Map()); // 即時緩存 - 用於播放邏輯
    const [generatingLines, setGeneratingLines] = useState(new Set()); // Set<lineIndex>
    const [currentPlayingLine, setCurrentPlayingLine] = useState(null); // 當前播放的行索引

    const currentAudioRef = useRef(null);
    const isPlayingRef = useRef(false);
    const textareaRef = useRef(null);

    // 初始化 API Key 從 localStorage
    useEffect(() => {
        const stored = localStorage.getItem('GEMINI_API_KEY');
        console.log('[INIT] 從 localStorage 讀取 API Key:', stored ? '✓ 已找到' : '✗ 未找到');
        if (stored) {
            setApiKey(stored);
            setTempApiKey(stored);
        }
    }, []);

    // 自動調整 textarea 高度
    const adjustTextareaHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    };

    // 監聽文本變化，自動調整高度
    useEffect(() => {
        adjustTextareaHeight();
    }, [text]);

    // 當文字改變時，清空音檔緩存
    useEffect(() => {
        // 清空緩存
        audioCacheRef.current = new Map();
        setAudioCache(new Map());
        console.log('[CACHE] 文字已改變，清空所有音檔緩存');
    }, [text]);

    // 保存 API Key
    const handleSaveApiKey = () => {
        console.log('[SETTINGS] 保存 API Key');
        localStorage.setItem('GEMINI_API_KEY', tempApiKey);
        setApiKey(tempApiKey);
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

    // 單段重新生成
    const handleRegenerateLine = async (lineIndex) => {
        console.log('[REGENERATE] 重新生成第', lineIndex + 1, '段');

        if (!apiKey) {
            alert('請先設定 API Key');
            return;
        }

        const lines = splitText(text);
        const lineText = lines[lineIndex];

        // 標記為生成中
        setGeneratingLines(prev => new Set(prev).add(lineIndex));

        try {
            const blob = await textToSpeech(lineText);
            if (blob) {
                // 同時更新 ref 和 state
                audioCacheRef.current.set(lineIndex, blob);
                setAudioCache(new Map(audioCacheRef.current));
                console.log('[REGENERATE] 第', lineIndex + 1, '段重新生成成功');
            } else {
                console.error('[REGENERATE] 第', lineIndex + 1, '段重新生成失敗');
            }
        } catch (error) {
            console.error('[REGENERATE] 錯誤:', error);
        } finally {
            // 移除生成中標記
            setGeneratingLines(prev => {
                const newSet = new Set(prev);
                newSet.delete(lineIndex);
                return newSet;
            });
        }
    };

    // 從該段後繼續播放
    const handlePlayFromLine = async (startIndex) => {
        console.log('[PLAY_FROM] 從第', startIndex + 1, '段開始播放');

        if (!apiKey) {
            alert('請先設定 API Key');
            return;
        }

        // 如果正在播放該段,則暫停
        if (currentPlayingLine === startIndex && isPlayingRef.current) {
            console.log('[PLAY_FROM] 暫停播放');
            isPlayingRef.current = false;
            if (currentAudioRef.current) {
                currentAudioRef.current.pause();
                currentAudioRef.current = null;
            }
            setCurrentPlayingLine(null);
            return;
        }

        // 停止當前播放
        if (isPlayingRef.current) {
            isPlayingRef.current = false;
            if (currentAudioRef.current) {
                currentAudioRef.current.pause();
                currentAudioRef.current = null;
            }
        }

        const lines = splitText(text);
        isPlayingRef.current = true;

        try {
            const CONCURRENT_BATCH_SIZE = 5;

            // 生成任務：批次生成缺失的音檔
            const generateTask = async () => {
                // 檢查需要生成的段落
                const linesToGenerate = [];
                for (let i = startIndex; i < lines.length; i++) {
                    if (!audioCacheRef.current.has(i)) {
                        linesToGenerate.push(i);
                    }
                }

                if (linesToGenerate.length === 0) {
                    console.log('[GENERATE] 所有音檔已緩存');
                    return;
                }

                console.log('[GENERATE] 需要生成', linesToGenerate.length, '段音檔');

                for (let i = 0; i < linesToGenerate.length; i += CONCURRENT_BATCH_SIZE) {
                    if (!isPlayingRef.current) {
                        console.log('[GENERATE] 播放已停止，中止生成');
                        break;
                    }

                    const batchEnd = Math.min(i + CONCURRENT_BATCH_SIZE, linesToGenerate.length);
                    const batch = linesToGenerate.slice(i, batchEnd);
                    console.log(`[GENERATE] 批次生成第 ${batch[0] + 1}-${batch[batch.length - 1] + 1} 段`);

                    // 標記為生成中
                    batch.forEach(lineIndex => {
                        setGeneratingLines(prev => new Set(prev).add(lineIndex));
                    });

                    // 並發生成這一批
                    const batchPromises = batch.map(async (lineIndex) => {
                        const lineText = lines[lineIndex];
                        try {
                            const blob = await textToSpeech(lineText);
                            if (blob) {
                                // 立即更新 ref
                                audioCacheRef.current.set(lineIndex, blob);
                                // 更新 state 供 UI 顯示
                                setAudioCache(new Map(audioCacheRef.current));
                                console.log(`[GENERATE] 第 ${lineIndex + 1} 段生成完成`);
                                return { index: lineIndex, blob };
                            }
                        } catch (error) {
                            console.error(`[GENERATE] 第 ${lineIndex + 1} 段生成錯誤:`, error);
                        } finally {
                            // 移除生成中標記
                            setGeneratingLines(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(lineIndex);
                                return newSet;
                            });
                        }
                        return { index: lineIndex, blob: null };
                    });

                    await Promise.all(batchPromises);
                }

                console.log('[GENERATE] 所有音檔生成完成');
            };

            // 播放任務：依序播放
            const playTask = async () => {
                // 先等待第一批（起始的 5 段或到結尾）生成完成
                const firstBatchEnd = Math.min(startIndex + CONCURRENT_BATCH_SIZE, lines.length);
                console.log(`[PLAY] 等待第一批（第 ${startIndex + 1}-${firstBatchEnd} 段）生成完成...`);

                for (let i = startIndex; i < firstBatchEnd; i++) {
                    while (!audioCacheRef.current.has(i)) {
                        if (!isPlayingRef.current) {
                            console.log('[PLAY] 播放已停止，停止等待');
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                console.log('[PLAY] 第一批生成完成，開始播放');

                // 依序播放所有段落
                for (let i = startIndex; i < lines.length; i++) {
                    if (!isPlayingRef.current) {
                        console.log('[PLAY] 播放已停止');
                        break;
                    }

                    // 等待音檔準備好（檢查 ref）
                    while (!audioCacheRef.current.has(i)) {
                        if (!isPlayingRef.current) {
                            console.log('[PLAY] 播放已停止，停止等待');
                            return;
                        }
                        console.log(`[PLAY] 等待第 ${i + 1} 段音檔...`);
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    const blob = audioCacheRef.current.get(i);
                    if (blob) {
                        setCurrentPlayingLine(i);
                        const isLastLine = i === lines.length - 1;
                        const delay = isLastLine ? 0 : 200;
                        console.log(`[PLAY] 播放第 ${i + 1} 段`);
                        await playBlob(blob, delay);
                    } else {
                        console.warn(`[PLAY] 跳過第 ${i + 1} 段（無音檔）`);
                    }
                }

                console.log('[PLAY] 播放完成');
            };

            // 並行執行生成和播放
            await Promise.all([generateTask(), playTask()]);

        } catch (error) {
            console.error('[PLAY_FROM] 播放錯誤:', error);
        } finally {
            isPlayingRef.current = false;
            setCurrentPlayingLine(null);
        }
    };

    // 合併並下載所有音檔
    const handleDownloadAll = async () => {
        console.log('[DOWNLOAD] 開始下載所有音檔');

        const lines = splitText(text);
        if (lines.length === 0) {
            alert('沒有文字內容可以下載');
            return;
        }

        // 檢查是否所有段落都已生成
        const missingLines = [];
        for (let i = 0; i < lines.length; i++) {
            if (!audioCacheRef.current.has(i)) {
                missingLines.push(i + 1);
            }
        }

        if (missingLines.length > 0) {
            alert(`請先生成所有音檔再下載\n缺少第 ${missingLines.join(', ')} 段`);
            return;
        }

        try {
            console.log('[DOWNLOAD] 開始合併音檔...');

            // 讀取所有 WAV 檔案的音訊數據
            const audioDataArrays = [];
            let totalDataLength = 0;
            let sampleRate = 24000;
            let numChannels = 1;
            let bitsPerSample = 16;

            for (let i = 0; i < lines.length; i++) {
                const blob = audioCacheRef.current.get(i);
                if (!blob) continue;

                // 讀取 blob 為 ArrayBuffer
                const arrayBuffer = await blob.arrayBuffer();
                const dataView = new DataView(arrayBuffer);

                // 解析 WAV 檔頭（前 44 bytes）
                if (i === 0) {
                    // 從第一個檔案讀取參數
                    numChannels = dataView.getUint16(22, true);
                    sampleRate = dataView.getUint32(24, true);
                    bitsPerSample = dataView.getUint16(34, true);
                    console.log(`[DOWNLOAD] 音訊參數: ${numChannels} 聲道, ${sampleRate}Hz, ${bitsPerSample}bit`);
                }

                // 提取音訊數據（跳過 44 bytes 檔頭）
                const audioData = new Uint8Array(arrayBuffer, 44);
                audioDataArrays.push(audioData);
                totalDataLength += audioData.length;
            }

            console.log(`[DOWNLOAD] 合併 ${audioDataArrays.length} 個音檔，總大小: ${totalDataLength} bytes`);

            // 創建合併後的音訊數據
            const mergedAudioData = new Uint8Array(totalDataLength);
            let offset = 0;
            for (const audioData of audioDataArrays) {
                mergedAudioData.set(audioData, offset);
                offset += audioData.length;
            }

            // 創建新的 WAV 檔頭
            const wavHeader = createWavHeader(totalDataLength, {
                numChannels,
                sampleRate,
                bitsPerSample
            });

            // 合併檔頭和音訊數據
            const finalWavData = new Uint8Array(wavHeader.length + totalDataLength);
            finalWavData.set(wavHeader, 0);
            finalWavData.set(mergedAudioData, wavHeader.length);

            // 創建 Blob 並下載
            const finalBlob = new Blob([finalWavData], { type: 'audio/wav' });
            const url = URL.createObjectURL(finalBlob);

            // 創建下載連結
            const a = document.createElement('a');
            a.href = url;
            a.download = `tts-audio-${Date.now()}.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('[DOWNLOAD] 下載完成');
        } catch (error) {
            console.error('[DOWNLOAD] 下載錯誤:', error);
            alert(`下載失敗: ${error.message}`);
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
                                setViewMode('settings');
                            }}
                            className={`flex-1 flex justify-center items-center p-3 rounded-lg transition-colors hover:cursor-pointer ${viewMode === 'settings'
                                ? 'bg-black text-white'
                                : ''
                                }`}
                            style={viewMode !== 'settings' ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                            title="設定"
                        >
                            <Settings size={24} />
                        </button>

                        {/* Square Pen 按鈕 */}
                        <button
                            onClick={() => setViewMode('edit')}
                            className={`flex-1 flex justify-center items-center p-3 rounded-lg transition-colors hover:cursor-pointer ${viewMode === 'edit'
                                ? 'bg-black text-white'
                                : ''
                                }`}
                            style={viewMode !== 'edit' ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                            title="編輯模式"
                        >
                            <SquarePen size={24} />
                        </button>

                        {/* Book Headphones 按鈕 */}
                        <button
                            onClick={() => setViewMode('read')}
                            className={`flex-1 flex justify-center items-center p-3 rounded-lg transition-colors hover:cursor-pointer ${viewMode === 'read'
                                ? 'bg-black text-white'
                                : ''
                                }`}
                            style={viewMode !== 'read' ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                            title="朗讀模式"
                        >
                            <BookHeadphones size={24} />
                        </button>
                    </div>
                </div>

                {/* 朗讀內容顯示 - 分割為 div */}
                {viewMode === 'read' && (
                    <div className="mb-4">
                        <div className="p-4 bg-white rounded-lg border-2 border-black min-h-60vh mb-4">
                            {text.trim() ? (
                                <div className="space-y-3">
                                    {splitText(text).map((line, index) => {
                                        const isGenerating = generatingLines.has(index);
                                        const isCached = audioCache.has(index);
                                        const isPlaying = currentPlayingLine === index;
                                        const isFirstLine = index === 0;
                                        const isEnabled = isCached && !isGenerating;

                                        // 檢查是否有任何段落正在生成
                                        const hasAnyGenerating = generatingLines.size > 0;
                                        // 檢查是否有其他段落正在播放
                                        const isAnyOtherPlaying = currentPlayingLine !== null && currentPlayingLine !== index;

                                        // 重新生成按鈕：只有已緩存的段落才能重新生成，且不能在播放時操作
                                        const regenerateButtonEnabled = !apiKey || isPlayingRef.current || !isCached ? false : !isGenerating;

                                        // 播放按鈕邏輯：
                                        // 1. 如果正在播放該段 → 可點擊（暫停）
                                        // 2. 如果有任何段落正在生成 → 全部禁用
                                        // 3. 如果有其他段落正在播放 → 禁用
                                        // 4. 第一個段落永遠可點擊（引導使用者從這裡開始）
                                        // 5. 其他段落需要已緩存才能點擊
                                        const playButtonEnabled = !apiKey
                                            ? false
                                            : isPlaying
                                                ? true
                                                : hasAnyGenerating
                                                    ? false
                                                    : isAnyOtherPlaying
                                                        ? false
                                                        : isFirstLine
                                                            ? true
                                                            : isCached;

                                        return (
                                            <div
                                                key={index}
                                                className={`flex gap-3 p-3 rounded-lg border transition-colors ${isPlaying
                                                    ? 'border-yellow-500 bg-yellow-50'
                                                    : 'border-gray-300 bg-white'
                                                    }`}
                                            >
                                                {/* 序號 - 正方形 */}
                                                <div className="flex items-center justify-center w-12 h-12 flex-shrink-0">
                                                    <span className="text-sm font-medium text-gray-500">{index + 1}</span>
                                                </div>

                                                {/* 文字內容 - 佔用剩餘空間 */}
                                                <div className="flex items-center flex-1 min-w-0">
                                                    <span className="text-black break-words">{line}</span>
                                                </div>

                                                {/* Rotate CCW 按鈕 - 正方形 */}
                                                <div className="flex items-center justify-center w-12 h-12 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleRegenerateLine(index)}
                                                        disabled={!regenerateButtonEnabled}
                                                        className={`w-full h-full p-2 rounded-lg flex items-center justify-center transition-colors ${regenerateButtonEnabled
                                                            ? 'bg-black text-white hover:bg-gray-800 hover:cursor-pointer'
                                                            : 'cursor-not-allowed'
                                                            }`}
                                                        style={!regenerateButtonEnabled ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                                                        title={
                                                            !apiKey
                                                                ? '請先設定 API Key'
                                                                : isPlayingRef.current
                                                                    ? '播放中無法重新生成'
                                                                    : !isCached
                                                                        ? '請先生成音檔'
                                                                        : isGenerating
                                                                            ? '生成中...'
                                                                            : '重新生成'
                                                        }
                                                    >
                                                        {isGenerating ? (
                                                            <Loader2 size={20} className="animate-spin" />
                                                        ) : (
                                                            <RotateCcw size={20} />
                                                        )}
                                                    </button>
                                                </div>

                                                {/* 播放按鈕 - 正方形 */}
                                                <div className="flex items-center justify-center w-12 h-12 flex-shrink-0">
                                                    <button
                                                        onClick={() => handlePlayFromLine(index)}
                                                        disabled={!playButtonEnabled}
                                                        className={`w-full h-full p-2 rounded-lg flex items-center justify-center transition-colors ${isPlaying
                                                            ? 'bg-black text-white hover:bg-gray-800 hover:cursor-pointer'
                                                            : playButtonEnabled
                                                                ? 'bg-black text-white hover:bg-gray-800 hover:cursor-pointer'
                                                                : 'cursor-not-allowed'
                                                            }`}
                                                        style={!playButtonEnabled ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                                                        title={
                                                            !apiKey
                                                                ? '請先設定 API Key'
                                                                : isPlaying
                                                                    ? '暫停'
                                                                    : hasAnyGenerating
                                                                        ? '生成中，請稍候...'
                                                                        : isAnyOtherPlaying
                                                                            ? '其他段落播放中'
                                                                            : isFirstLine
                                                                                ? '從第一段開始播放'
                                                                                : isCached
                                                                                    ? '從此段開始播放'
                                                                                    : '請先從第一段開始播放'
                                                        }
                                                    >
                                                        {isPlaying ? (
                                                            <Pause size={20} />
                                                        ) : (
                                                            <Play size={20} />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center text-gray-400 py-12">
                                    還沒有文字內容，請先切換到編輯模式輸入文字
                                </div>
                            )}
                        </div>

                        {/* 下載按鈕 */}
                        {text.trim() && (
                            <button
                                onClick={handleDownloadAll}
                                disabled={!apiKey || isPlayingRef.current || generatingLines.size > 0}
                                className={`w-full p-4 rounded-lg flex items-center justify-center gap-2 transition-colors font-medium ${!apiKey || isPlayingRef.current || generatingLines.size > 0
                                    ? 'cursor-not-allowed'
                                    : 'bg-black text-white hover:bg-gray-800 hover:cursor-pointer'
                                    }`}
                                style={!apiKey || isPlayingRef.current || generatingLines.size > 0 ? { backgroundColor: '#d9d9d9', color: '#fff' } : {}}
                                title={
                                    !apiKey
                                        ? '請先設定 API Key'
                                        : isPlayingRef.current
                                            ? '播放中無法下載'
                                            : generatingLines.size > 0
                                                ? '生成中，請稍候...'
                                                : '下載所有音檔（需先生成完所有段落）'
                                }
                            >
                                <Download size={24} />
                                <span>下載合併音檔</span>
                            </button>
                        )}
                    </div>
                )}

                {/* 編輯區 */}
                {viewMode === 'edit' && (
                    <div className="mb-4">
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={(e) => {
                                setText(e.target.value);
                            }}
                            placeholder="在此輸入要轉換的文字，按換行分段..."
                            suppressHydrationWarning
                            className="w-full p-4 rounded-lg border-2 border-black focus:border-black focus:outline-none resize-none overflow-hidden transition-all bg-white text-black"
                            style={{ minHeight: '60vh' }}
                        />
                    </div>
                )}

                {/* 設定區 */}
                {viewMode === 'settings' && (
                    <div className="mb-4 p-6 bg-white rounded-lg border-2 border-black">
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
                                onClick={() => setViewMode('edit')}
                                className="flex-1 px-4 py-2 bg-gray-300 text-black rounded-lg hover:bg-gray-400 transition-colors font-medium"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    handleSaveApiKey();
                                    setViewMode('edit');
                                }}
                                className="flex-1 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
