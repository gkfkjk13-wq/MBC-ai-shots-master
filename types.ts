
export interface Scene {
  imagePrompt: string;
  narration: string;
  ambientSoundPrompt: string;
  imageUrl?: string;
  imageBase64?: string;
  audioUrl?: string;
  audioBase64?: string;
  videoUrl?: string;
}

export interface ShortsScript {
  title: string;
  scenes: Scene[];
  visualStyle: string;
}

export interface GeneratedAsset {
  id: string;
  url: string;
  base64: string;
  type: 'image' | 'audio' | 'video';
  prompt?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
  GENERATING_IMAGES = 'GENERATING_IMAGES',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  ZIPPING = 'ZIPPING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}
