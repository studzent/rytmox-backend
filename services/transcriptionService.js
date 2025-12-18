const openai = require("../utils/openaiClient");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Транскрибировать аудио файл через OpenAI Whisper API
 * @param {string} audioFilePath - Путь к аудио файлу
 * @param {string} language - Язык (по умолчанию 'ru' для русского)
 * @returns {Promise<{data: string|null, error: object|null}>}
 */
async function transcribeAudio(audioFilePath, language = 'ru') {
  try {
    console.log(`[transcriptionService] Starting transcription for file: ${audioFilePath}`);
    
    // Проверяем существование файла
    if (!fs.existsSync(audioFilePath)) {
      return {
        data: null,
        error: {
          message: "Audio file not found",
          code: "FILE_NOT_FOUND",
        },
      };
    }

    // Проверяем размер файла (Whisper API лимит: 25MB)
    const stats = fs.statSync(audioFilePath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    console.log(`[transcriptionService] File size: ${fileSizeInMB.toFixed(2)} MB`);
    
    if (fileSizeInMB > 25) {
      return {
        data: null,
        error: {
          message: `Audio file is too large (${fileSizeInMB.toFixed(2)} MB). Maximum size is 25 MB.`,
          code: "FILE_TOO_LARGE",
        },
      };
    }

    // Создаем File объект для OpenAI API
    const audioFile = fs.createReadStream(audioFilePath);
    const filename = path.basename(audioFilePath);

    // Вызываем OpenAI Whisper API с увеличенным таймаутом для долгих аудио
    // Whisper API может обрабатывать до 25MB файлы, что примерно 25 минут аудио
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: language,
      response_format: "text",
    }, {
      timeout: 300000, // 5 минут таймаут для долгих аудио
    });

    console.log(`[transcriptionService] Transcription successful: ${transcription.substring(0, 100)}...`);

    // Удаляем временный файл
    try {
      fs.unlinkSync(audioFilePath);
    } catch (unlinkError) {
      console.warn(`[transcriptionService] Failed to delete temp file:`, unlinkError);
    }

    return {
      data: transcription.trim(),
      error: null,
    };
  } catch (err) {
    console.error(`[transcriptionService] Error in transcribeAudio:`, err);
    
    // Удаляем временный файл даже при ошибке
    try {
      if (fs.existsSync(audioFilePath)) {
        fs.unlinkSync(audioFilePath);
      }
    } catch (unlinkError) {
      console.warn(`[transcriptionService] Failed to delete temp file after error:`, unlinkError);
    }

    return {
      data: null,
      error: {
        message: err.message || "Failed to transcribe audio",
        code: "TRANSCRIPTION_ERROR",
      },
    };
  }
}

/**
 * Сохранить base64 аудио во временный файл
 * @param {string} base64Audio - Base64 строка аудио
 * @param {string} mimeType - MIME тип (например, 'audio/m4a', 'audio/mp3')
 * @returns {Promise<{data: string|null, error: object|null}>} - Путь к временному файлу
 */
async function saveBase64AudioToFile(base64Audio, mimeType = 'audio/m4a') {
  try {
    // Определяем расширение файла из MIME типа
    const extensionMap = {
      'audio/m4a': '.m4a',
      'audio/mp3': '.mp3',
      'audio/mp4': '.m4a',
      'audio/wav': '.wav',
      'audio/webm': '.webm',
      'audio/aac': '.aac',
    };
    const extension = extensionMap[mimeType] || '.m4a';

    // Создаем временный файл
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `audio_${Date.now()}${extension}`);

    // Декодируем base64 и сохраняем
    const base64Data = base64Audio.replace(/^data:audio\/\w+;base64,/, '');
    const audioBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempFilePath, audioBuffer);

    console.log(`[transcriptionService] Saved temp audio file: ${tempFilePath}`);
    
    return {
      data: tempFilePath,
      error: null,
    };
  } catch (err) {
    console.error(`[transcriptionService] Error saving base64 audio:`, err);
    return {
      data: null,
      error: {
        message: err.message || "Failed to save audio file",
        code: "FILE_SAVE_ERROR",
      },
    };
  }
}

module.exports = {
  transcribeAudio,
  saveBase64AudioToFile,
};

