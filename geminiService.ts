
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ShortsScript } from "./types";

// Always initialize with { apiKey: process.env.API_KEY } directly as per guidelines
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateShortsScript = async (topic: string, imageCount: number, preferredStyle: string): Promise<ShortsScript> => {
  const ai = getAI();
  
  const count = imageCount === 0 ? 5 : imageCount;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `'${topic}'를 주제로 한 쇼츠 영상 대본을 작성해줘. 
    사용자가 원하는 스타일은 '${preferredStyle}'이야. 
    반드시 한국어로 응답하고 지정된 JSON 형식을 지켜줘. 
    전체 영상은 총 ${count}개의 장면(scenes)으로 구성해줘.
    각 장면(scene)은 다음을 포함해야 해:
    1. imagePrompt: 장면을 설명하는 상세한 영어 이미지 생성 프롬프트
    2. narration: 해당 장면에서 나올 한국어 나레이션 대사 (짧고 강렬하게)
    3. ambientSoundPrompt: 해당 장면에 어울리는 배경음/효과음 묘사 (영어)`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          visualStyle: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                imagePrompt: { type: Type.STRING },
                narration: { type: Type.STRING },
                ambientSoundPrompt: { type: Type.STRING }
              },
              required: ["imagePrompt", "narration", "ambientSoundPrompt"]
            },
            minItems: count,
            maxItems: count
          }
        },
        required: ["title", "visualStyle", "scenes"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateImage = async (prompt: string, aspectRatio: string = "1:1"): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: prompt,
    config: {
      imageConfig: {
        aspectRatio: aspectRatio as any
      }
    }
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  throw new Error("이미지 데이터를 받지 못했습니다.");
};

export const generateTTS = async (text: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("오디오 데이터를 받지 못했습니다.");
  return base64Audio;
};

export const generateVideoFromImage = async (prompt: string, imageBase64: string, aspectRatio: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    image: {
      imageBytes: imageBase64,
      mimeType: 'image/png',
    },
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: aspectRatio as any
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  const blob = await response.blob();
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
};
