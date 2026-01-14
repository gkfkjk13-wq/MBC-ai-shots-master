
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppStatus, ShortsScript, Scene } from './types';
import { generateShortsScript, generateImage, generateTTS, generateVideoFromImage } from './geminiService';
import { decodeBase64, decodeAudioData, audioBufferToWavBlob } from './utils';

const STYLE_OPTIONS = [
  "실사 (Realistic Photo)", "3D 애니메이션", "인상주의 (Impressionism)", "큐비즘 (Cubism)", "리얼리즘 (Realism)", 
  "초현실주의 (Surrealism)", "종이 (Paper Art)", "표현주의 (Expressionism)", "미니멀리즘 (Minimalism)", 
  "풍경화와 자연화 (Landscape)", "픽셀 아트 (Pixel Art)", "만화와 코믹스 (Cartoon)", "아르데코 (Art Deco)", 
  "기하학적 및 프랙탈 아트", "팝 아트 (Pop Art)", "르네상스 (Renaissance)", "SF 및 판타지", 
  "초상화 (Portrait)", "플랫 디자인 (Flat Design)", "아이소메트릭 (Isometric)", "수채화 (Watercolor)", 
  "스케치 (Sketch)", "빈센트 반 고흐 스타일", "클로드 모네 스타일", "파블로 피카소 스타일", 
  "살바도르 달리 스타일", "프리다 칼로 스타일"
];

const RATIO_OPTIONS = ["9:16", "16:9", "1:1", "4:3", "3:4"];

// window 객체 타입 확장 - Fixing declarations to match expected AIStudio type and modifiers
declare global {
  interface Window {
    aistudio: AIStudio;
  }
}

const App: React.FC = () => {
  const [topic, setTopic] = useState<string>('겨울철 별미');
  const [imageCount, setImageCount] = useState<number>(5);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [selectedStyle, setSelectedStyle] = useState<string>("실사 (Realistic Photo)");
  const [customStyle, setCustomStyle] = useState<string>("");
  
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [script, setScript] = useState<ShortsScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [syncNeeded, setSyncNeeded] = useState<Record<number, boolean>>({});

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const finalStyle = customStyle.trim() !== "" ? customStyle : selectedStyle;

  // API 키 체크 함수
  const checkApiKey = async () => {
    if (typeof window.aistudio !== 'undefined') {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
      }
    }
  };

  const handleError = (err: any) => {
    console.error(err);
    let msg = err.message || '오류가 발생했습니다.';
    if (msg.includes('permission denied') || msg.includes('entity was not found')) {
      msg = 'API 권한이 거부되었습니다. 올바른 API 키가 선택되었는지 확인해 주세요.';
      setError(msg);
      // 권한 오류 시 키 선택창 유도
      if (window.aistudio) window.aistudio.openSelectKey();
    } else {
      setError(msg);
    }
    setStatus(AppStatus.ERROR);
  };

  const handleStartCreation = async () => {
    if (!topic.trim()) return;
    try {
      setError(null);
      setStatus(AppStatus.GENERATING_SCRIPT);
      const generatedScript = await generateShortsScript(topic, imageCount, finalStyle);
      
      setStatus(AppStatus.GENERATING_IMAGES);
      const updatedScenes = [...generatedScript.scenes];
      for (let i = 0; i < updatedScenes.length; i++) {
        const combinedPrompt = `${updatedScenes[i].imagePrompt}, style: ${generatedScript.visualStyle}, high quality`;
        const base64 = await generateImage(combinedPrompt, aspectRatio);
        updatedScenes[i].imageUrl = `data:image/png;base64,${base64}`;
        updatedScenes[i].imageBase64 = base64;
        setScript({ ...generatedScript, scenes: [...updatedScenes] });
      }

      setStatus(AppStatus.GENERATING_AUDIO);
      for (let i = 0; i < updatedScenes.length; i++) {
        const audioBase64 = await generateTTS(updatedScenes[i].narration);
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const decoded = await decodeAudioData(decodeBase64(audioBase64), audioCtx, 24000, 1);
        const wavBlob = audioBufferToWavBlob(decoded);
        updatedScenes[i].audioUrl = URL.createObjectURL(wavBlob);
        updatedScenes[i].audioBase64 = audioBase64;
        setScript({ ...generatedScript, scenes: [...updatedScenes] });
      }
      setStatus(AppStatus.COMPLETED);
    } catch (err) { handleError(err); }
  };

  // 대본(나레이션) 수정 시 오디오만 즉시 업데이트
  const handleUpdateNarrationOnly = async (index: number) => {
    if (!script) return;
    const key = `audio-${index}`;
    try {
      setLoadingStates(prev => ({ ...prev, [key]: true }));
      const audioBase64 = await generateTTS(script.scenes[index].narration);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const decoded = await decodeAudioData(decodeBase64(audioBase64), audioCtx, 24000, 1);
      const wavBlob = audioBufferToWavBlob(decoded);
      
      const newScenes = [...script.scenes];
      newScenes[index].audioUrl = URL.createObjectURL(wavBlob);
      newScenes[index].audioBase64 = audioBase64;
      
      setScript({ ...script, scenes: newScenes });
      setSyncNeeded(prev => ({ ...prev, [index]: false }));
    } catch (err) { handleError(err); }
    finally { setLoadingStates(prev => ({ ...prev, [key]: false })); }
  };

  // 전체 수정 사항 적용 (이미지 + 나레이션)
  const handleApplyFullChanges = async (index: number) => {
    if (!script) return;
    const key = `full-${index}`;
    try {
      setLoadingStates(prev => ({ ...prev, [key]: true }));
      
      // 이미지 & 오디오 동시 업데이트
      const [imgBase64, audioBase64] = await Promise.all([
        generateImage(`${script.scenes[index].imagePrompt}, style: ${script.visualStyle}, high quality`, aspectRatio),
        generateTTS(script.scenes[index].narration)
      ]);

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const decoded = await decodeAudioData(decodeBase64(audioBase64), audioCtx, 24000, 1);
      const wavBlob = audioBufferToWavBlob(decoded);

      const newScenes = [...script.scenes];
      newScenes[index] = {
        ...newScenes[index],
        imageUrl: `data:image/png;base64,${imgBase64}`,
        imageBase64: imgBase64,
        audioUrl: URL.createObjectURL(wavBlob),
        audioBase64: audioBase64,
        videoUrl: undefined
      };
      
      setScript({ ...script, scenes: newScenes });
      setSyncNeeded(prev => ({ ...prev, [index]: false }));
      setCurrentSceneIdx(index);
    } catch (err) { handleError(err); }
    finally { setLoadingStates(prev => ({ ...prev, [key]: false })); }
  };

  const handleMakeVideoWithKey = async (index: number) => {
    await checkApiKey();
    const key = `video-${index}`;
    try {
      setLoadingStates(prev => ({ ...prev, [key]: true }));
      const videoUrl = await generateVideoFromImage(script!.scenes[index].imagePrompt, script!.scenes[index].imageBase64!, aspectRatio);
      const newScenes = [...script!.scenes];
      newScenes[index].videoUrl = videoUrl;
      setScript({ ...script!, scenes: newScenes });
    } catch (err) { handleError(err); }
    finally { setLoadingStates(prev => ({ ...prev, [key]: false })); }
  };

  const updateSceneText = (index: number, field: keyof Scene, value: string) => {
    if (!script) return;
    const newScenes = [...script.scenes];
    (newScenes[index] as any)[field] = value;
    setScript({ ...script, scenes: newScenes });
    setSyncNeeded(prev => ({ ...prev, [index]: true }));
  };

  const playNext = useCallback(() => {
    if (!script) return;
    if (currentSceneIdx < script.scenes.length - 1) {
      setCurrentSceneIdx(prev => prev + 1);
    } else {
      setIsPlaying(false);
      setCurrentSceneIdx(0);
    }
  }, [currentSceneIdx, script]);

  useEffect(() => {
    if (isPlaying && audioRef.current) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [currentSceneIdx, isPlaying]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20 selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto px-4 py-8 md:py-16">
        <header className="text-center mb-12">
          <div className="inline-block px-4 py-1.5 mb-4 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold tracking-widest uppercase">
            AI Studio Pro
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-4 tracking-tighter">
            AI <span className="text-blue-500">숏폼</span> 에디터
          </h1>
          <p className="text-slate-400 text-lg">장면별 대본을 수정하고 실시간으로 음성을 동기화하세요.</p>
        </header>

        <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[3rem] shadow-2xl p-6 md:p-12 border border-slate-800/50 mb-8 overflow-hidden relative">
          
          {status === AppStatus.IDLE && (
            <div className="flex flex-col items-center py-10 animate-fadeIn relative z-10">
              <div className="w-full max-w-3xl space-y-12">
                <div className="space-y-4">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.2em] text-center">동영상 주제</label>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="예: 서울의 맛있는 떡볶이 맛집 탐방"
                    className="w-full px-10 py-7 bg-slate-800/50 border border-slate-700 rounded-3xl text-white focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-2xl font-bold shadow-2xl text-center"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-slate-800/30 p-8 rounded-[2.5rem] border border-slate-800 shadow-inner space-y-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">장면 수</label>
                      <select value={imageCount} onChange={(e) => setImageCount(parseInt(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 text-blue-400 font-black text-lg appearance-none">
                        <option value={0}>AI 자동 추천</option>
                        {[...Array(12)].map((_, i) => <option key={i+1} value={i+1}>{i+1}개 장면</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">화면 비율</label>
                      <div className="grid grid-cols-5 gap-2">
                        {RATIO_OPTIONS.map(r => (
                          <button key={r} onClick={() => setAspectRatio(r)} className={`py-3 rounded-xl text-[10px] font-black border transition-all ${aspectRatio === r ? 'bg-blue-600 border-blue-500 text-white shadow-lg' : 'bg-slate-900 border-slate-700 text-slate-600'}`}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-800/30 p-8 rounded-[2.5rem] border border-slate-800 shadow-inner flex flex-col justify-between">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">영상 스타일</label>
                      <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 text-emerald-400 font-black text-lg mb-4 appearance-none">
                        {STYLE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <input type="text" placeholder="스타일 직접 입력..." value={customStyle} onChange={(e) => setCustomStyle(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" />
                  </div>
                </div>
              </div>
              <button onClick={handleStartCreation} className="group mt-16 px-20 py-8 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-[2.5rem] shadow-2xl flex items-center gap-5 text-3xl transition-all active:scale-95">
                생성 시작 <i className="fa-solid fa-magic group-hover:rotate-12 transition-transform"></i>
              </button>
              {window.aistudio && (
                <button onClick={() => window.aistudio.openSelectKey()} className="mt-6 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:text-blue-500 transition-colors">
                  <i className="fa-solid fa-key mr-2"></i> API 키 설정하기
                </button>
              )}
            </div>
          )}

          {(status === AppStatus.GENERATING_SCRIPT || status === AppStatus.GENERATING_IMAGES || status === AppStatus.GENERATING_AUDIO) && (
            <div className="flex flex-col items-center justify-center py-32 space-y-12 animate-fadeIn">
              <div className="w-28 h-28 bg-blue-600 rounded-[2.5rem] flex items-center justify-center text-white text-5xl shadow-2xl animate-bounce">
                <i className={`fa-solid ${status === AppStatus.GENERATING_SCRIPT ? 'fa-pen-nib' : status === AppStatus.GENERATING_IMAGES ? 'fa-palette' : 'fa-microphone'}`}></i>
              </div>
              <h3 className="text-4xl font-black text-white">
                {status === AppStatus.GENERATING_SCRIPT ? "시나리오 작성 중..." : status === AppStatus.GENERATING_IMAGES ? "비주얼 에셋 생성 중..." : "나레이션 합성 중..."}
              </h3>
            </div>
          )}

          {status === AppStatus.COMPLETED && script && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-12 animate-fadeIn relative z-10">
              
              <div className="xl:col-span-5 space-y-8">
                <div className="sticky top-8 space-y-8">
                  <div className="flex items-center justify-between px-2">
                     <h2 className="text-2xl font-black text-white flex items-center gap-3">
                       <i className="fa-solid fa-play text-blue-500"></i> 마스터 프리뷰
                     </h2>
                  </div>
                  
                  <div className="relative bg-black rounded-[3rem] overflow-hidden shadow-2xl border border-slate-800 group" style={{ aspectRatio: aspectRatio.replace(':', '/') }}>
                    {script.scenes[currentSceneIdx].videoUrl ? (
                      <video src={script.scenes[currentSceneIdx].videoUrl} className="w-full h-full object-cover" autoPlay loop muted />
                    ) : script.scenes[currentSceneIdx].imageUrl ? (
                      <img src={script.scenes[currentSceneIdx].imageUrl} className="w-full h-full object-cover" alt="Preview" />
                    ) : null}

                    <div className="absolute bottom-12 left-0 right-0 px-10 text-center pointer-events-none">
                      <div className="inline-block bg-black/60 backdrop-blur-2xl px-6 py-3 rounded-2xl border border-white/10 shadow-2xl">
                        <p className="text-white text-lg md:text-xl font-black leading-tight">
                          {script.scenes[currentSceneIdx]?.narration}
                        </p>
                      </div>
                    </div>

                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                      <button onClick={() => setIsPlaying(!isPlaying)} className="w-24 h-24 bg-blue-600 hover:bg-blue-500 text-white rounded-full flex items-center justify-center text-4xl shadow-2xl transition-all active:scale-90">
                        <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-800 space-y-6">
                    <div className="flex items-center gap-6">
                      <button onClick={() => setIsPlaying(!isPlaying)} className="w-12 h-12 flex items-center justify-center bg-white text-slate-950 rounded-full text-lg active:scale-90 transition-all">
                        <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                      </button>
                      <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all" style={{ width: `${((currentSceneIdx + 1) / script.scenes.length) * 100}%` }}></div>
                      </div>
                    </div>
                    <button onClick={() => setStatus(AppStatus.IDLE)} className="w-full py-5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-black rounded-2xl border border-slate-700 transition-all">처음으로 돌아가기</button>
                  </div>

                  <audio ref={audioRef} src={script.scenes[currentSceneIdx]?.audioUrl} onEnded={playNext} className="hidden" />
                </div>
              </div>

              <div className="xl:col-span-7 space-y-8">
                <h2 className="text-2xl font-black text-white px-2"><i className="fa-solid fa-edit text-blue-500 mr-3"></i> 장면 타임라인 편집</h2>

                <div className="space-y-6">
                  {script.scenes.map((scene, idx) => {
                    const isFullLoading = loadingStates[`full-${idx}`];
                    const isAudioLoading = loadingStates[`audio-${idx}`];
                    const isVideoLoading = loadingStates[`video-${idx}`];
                    const isActive = currentSceneIdx === idx;
                    const needsSync = syncNeeded[idx];
                    
                    return (
                      <div key={`scene-${idx}`} className={`p-8 rounded-[3rem] border transition-all duration-500 ${isActive ? 'bg-blue-600/5 border-blue-500/40 shadow-xl' : 'bg-slate-800/20 border-slate-800/50'}`}>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                          <div className="md:col-span-4 space-y-4">
                            <div onClick={() => setCurrentSceneIdx(idx)} className="relative cursor-pointer rounded-3xl overflow-hidden bg-slate-950 aspect-square shadow-2xl">
                              {isFullLoading || isVideoLoading ? (
                                <div className="absolute inset-0 bg-black/80 z-20 flex flex-col items-center justify-center gap-3">
                                  <i className="fa-solid fa-circle-notch fa-spin text-blue-500 text-3xl"></i>
                                </div>
                              ) : scene.videoUrl ? (
                                <video src={scene.videoUrl} className="w-full h-full object-cover" autoPlay loop muted />
                              ) : scene.imageUrl ? (
                                <img src={scene.imageUrl} className="w-full h-full object-cover" alt={`Scene ${idx+1}`} />
                              ) : null}
                              {needsSync && (
                                <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-[2px] z-10 flex items-center justify-center">
                                  <span className="bg-blue-600 text-white text-[9px] font-black px-3 py-1.5 rounded-full shadow-lg animate-pulse uppercase">Sync Required</span>
                                </div>
                              )}
                              <div className="absolute top-4 left-4 bg-black/60 text-white text-[10px] font-black px-3 py-1.5 rounded-xl border border-white/10">SCENE {idx + 1}</div>
                            </div>
                            
                            <div className="grid grid-cols-1 gap-2">
                               <button onClick={() => handleApplyFullChanges(idx)} disabled={isFullLoading} className="py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-[11px] font-black uppercase transition-all shadow-lg disabled:opacity-50">
                                 전체 업데이트 (이미지+음성)
                               </button>
                               <button onClick={() => handleMakeVideoWithKey(idx)} disabled={isVideoLoading || isFullLoading || !scene.imageUrl} className="py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[10px] font-black uppercase transition-all border border-slate-700">
                                 비디오 변환 (Veo)
                               </button>
                            </div>
                          </div>

                          <div className="md:col-span-8 flex flex-col gap-6">
                            <div className="space-y-3">
                              <div className="flex justify-between items-end">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">나레이션 (한국어)</label>
                                <button 
                                  onClick={() => handleUpdateNarrationOnly(idx)} 
                                  disabled={isAudioLoading || !needsSync}
                                  className={`text-[9px] font-black px-4 py-2 rounded-xl border transition-all ${needsSync ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-600 opacity-50'}`}
                                >
                                  {isAudioLoading ? <i className="fa-solid fa-spinner fa-spin mr-2"></i> : <i className="fa-solid fa-microphone mr-2"></i>}
                                  음성만 다시 생성
                                </button>
                              </div>
                              <textarea 
                                value={scene.narration} 
                                onChange={(e) => updateSceneText(idx, 'narration', e.target.value)}
                                className="w-full h-32 bg-slate-900/40 p-5 rounded-2xl border border-slate-700 text-sm text-white focus:ring-2 focus:ring-blue-500/50 outline-none resize-none font-medium leading-relaxed"
                              />
                            </div>
                            <div className="space-y-3">
                              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">이미지 생성 프롬프트</label>
                              <textarea 
                                value={scene.imagePrompt} 
                                onChange={(e) => updateSceneText(idx, 'imagePrompt', e.target.value)}
                                className="w-full h-24 bg-slate-900/40 p-4 rounded-2xl border border-slate-700 text-xs text-slate-400 focus:ring-2 focus:ring-blue-500/50 outline-none resize-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {status === AppStatus.ERROR && (
            <div className="text-center py-24 animate-fadeIn">
              <div className="w-28 h-28 bg-red-500/10 text-red-500 rounded-[2.5rem] flex items-center justify-center text-5xl mx-auto mb-8 border border-red-500/20 shadow-2xl">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <h3 className="text-4xl font-black text-white mb-4">문제가 발생했습니다</h3>
              <p className="text-slate-400 mb-12 max-w-lg mx-auto font-medium text-lg leading-relaxed">{error}</p>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setStatus(AppStatus.IDLE)} className="px-16 py-6 bg-slate-800 text-white font-black rounded-3xl hover:bg-slate-700 transition-all active:scale-95">처음으로</button>
                {error?.includes('API 권한') && window.aistudio && (
                  <button onClick={() => window.aistudio.openSelectKey()} className="px-16 py-6 bg-blue-600 text-white font-black rounded-3xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-600/20 active:scale-95">API 키 설정 열기</button>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="text-center text-slate-800 text-[10px] mt-20 mb-10 opacity-30 uppercase tracking-[0.6em] font-black">
          <p>© {new Date().getFullYear()} AI SHORTS MASTER ENGINE • REAL-TIME SYNC STUDIO</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
