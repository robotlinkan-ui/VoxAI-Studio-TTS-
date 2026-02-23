/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic2, 
  Download, 
  Play, 
  Pause, 
  Volume2, 
  Settings2, 
  History, 
  User, 
  Sparkles,
  ChevronDown,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Upload,
  Globe,
  Repeat,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality } from "@google/genai";

// Utility to convert raw PCM base64 from Gemini to a playable WAV URL
const createWavUrl = (base64: string, sampleRate = 24000): string => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + bytes.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, bytes.length, true);
  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(bytes);
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

// Available voices in Gemini TTS
const VOICES = [
  { id: 'Puck', name: 'VoxAI Frank (Friend Style)', description: 'A highly realistic, casual, and friendly conversational voice, exactly like an ElevenLabs Friend Character. Speaks naturally with perfect pacing, warm tone, and engaging delivery.', gender: 'Male', tags: ['friendly', 'podcast', 'casual', 'elevenlabs'] },
  { id: 'Charon', name: 'VoxAI Marcus (Corporate)', description: 'Clear, professional, and steady. Perfect for corporate presentations.', gender: 'Male', tags: ['Corporate', 'Normal'] },
  { id: 'Fenrir', name: 'VoxAI Palit (Documentary)', description: 'World-class documentary voice. Deep, emotional, perfect pacing, and highly engaging.', gender: 'Male', tags: ['Documentary', 'Emotional', 'Premium'] },
  { id: 'Kore', name: 'VoxAI Sarah (Cheerful)', description: 'Bright, energetic, and friendly. Great for ads and social media.', gender: 'Female', tags: ['Ad', 'Social'] },
  { id: 'Zephyr', name: 'VoxAI Luna (Soft)', description: 'Calm, soothing, and gentle. Perfect for meditation or ASMR.', gender: 'Female', tags: ['Meditation', 'ASMR'] },
];

interface HistoryItem {
  id: string;
  text: string;
  voice: string;
  audioUrl: string;
  timestamp: number;
}

export default function App() {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMonetization, setShowMonetization] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // New Features State
  const [mode, setMode] = useState<'tts' | 'voice_changer' | 'dubbing'>('tts');
  const [uploadedAudio, setUploadedAudio] = useState<{ file: File, base64: string, mimeType: string } | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('Hindi');
  
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string, credits: number, isPremium: boolean } | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const MAX_CHARS = 20000;

  // Fetch user on load
  useEffect(() => {
    fetch('/api/user')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && !data.error) {
          setUser(data);
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        setUser(null);
      });
  }, []);

  // Listen for OAuth success
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetch('/api/user')
          .then(res => res.json())
          .then(data => setUser(data))
          .catch(console.error);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const { url } = await res.json();
      window.open(url, 'oauth_popup', 'width=600,height=700');
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      // Optional: Clear history or reset state
      setHistory([]);
      setAudioUrl(null);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const filteredVoices = VOICES.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    v.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 50MB limit
    if (file.size > 50 * 1024 * 1024) {
      setError("File size exceeds 50MB limit.");
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      setUploadedAudio({ file, base64: base64String, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const playVoicePreview = async (voice: typeof VOICES[0]) => {
    if (previewingVoice === voice.id) return;
    setPreviewingVoice(voice.id);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: "Hello, this is a preview of my voice." }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice.id },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const url = createWavUrl(base64Audio);
        if (previewAudioRef.current) {
          previewAudioRef.current.src = url;
          previewAudioRef.current.play();
        }
      }
    } catch (err) {
      console.error("Preview failed", err);
    } finally {
      setTimeout(() => setPreviewingVoice(null), 2000);
    }
  };

  const generateSpeech = async () => {
    if (!user) {
      handleLogin();
      return;
    }

    let processingText = text;

    // Handle Voice Changer & Dubbing modes
    if (mode !== 'tts') {
      if (!uploadedAudio) {
        setError("Please upload an audio file first.");
        return;
      }
      setIsGenerating(true);
      setLoadingStatus(mode === 'dubbing' ? 'Translating audio...' : 'Analyzing audio...');
      setError(null);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = mode === 'dubbing' 
          ? `Translate the speech in this audio to ${targetLanguage}. Return ONLY the translated text, nothing else.` 
          : `Transcribe the speech in this audio exactly. Return ONLY the transcription, nothing else.`;
          
        const textResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            { parts: [
              { inlineData: { data: uploadedAudio.base64, mimeType: uploadedAudio.mimeType } },
              { text: prompt }
            ]}
          ]
        });
        
        processingText = textResponse.text || '';
        if (!processingText.trim()) throw new Error("Could not extract speech from audio.");
        
        // Update the text area so the user sees what was generated (optional, but good for transparency)
        setText(processingText);
      } catch (err: any) {
        console.error(err);
        setError("Failed to process audio file. " + err.message);
        setIsGenerating(false);
        setLoadingStatus(null);
        return;
      }
    }

    if (!processingText.trim()) {
      setError("Text is empty.");
      setIsGenerating(false);
      setLoadingStatus(null);
      return;
    }

    if (processingText.length > MAX_CHARS) {
      setError(`Text exceeds the ${MAX_CHARS} character limit.`);
      setIsGenerating(false);
      setLoadingStatus(null);
      return;
    }

    if (user.credits !== Infinity && user.credits < processingText.length) {
      setError(`Insufficient credits. You need ${processingText.length} credits but have ${user.credits}. Please upgrade to Premium.`);
      setShowMonetization(true);
      setIsGenerating(false);
      setLoadingStatus(null);
      return;
    }
    
    setIsGenerating(true);
    setLoadingStatus('Generating AI voice...');
    setError(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      // Re-initialize to ensure fresh API key
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Pass the pure text to the TTS model to avoid hallucinations, weird noises, or reading instructions aloud
      const responsePromise = ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: processingText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice.id },
            },
          },
        },
      });

      // Implement a race between the API call and the abort signal
      const response = await Promise.race([
        responsePromise,
        new Promise<any>((_, reject) => {
          if (abortControllerRef.current?.signal.aborted) {
            reject(new Error('AbortError'));
          }
          abortControllerRef.current?.signal.addEventListener('abort', () => {
            reject(new Error('AbortError'));
          });
        })
      ]);

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        // Deduct credits
        if (user.credits !== Infinity) {
          fetch('/api/user/deduct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: processingText.length })
          }).then(res => res.json()).then(data => setUser(data)).catch(console.error);
        }

        const url = createWavUrl(base64Audio);
        setAudioUrl(url);
        
        const newItem: HistoryItem = {
          id: Math.random().toString(36).substr(2, 9),
          text: processingText.length > 80 ? processingText.substring(0, 80) + '...' : processingText,
          voice: selectedVoice.name,
          audioUrl: url,
          timestamp: Date.now(),
        };
        setHistory(prev => [newItem, ...prev]);
        
        // Auto-play for "Fast" feel
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.playbackRate = speed; // Apply speed to player
            audioRef.current.play();
            setIsPlaying(true);
          }
        }, 50);
      } else {
        throw new Error("The AI model returned an empty response. Please try again with shorter text or a different voice.");
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        console.log("Generation cancelled by user.");
        return;
      }
      console.error("Generation Error:", err);
      if (err.message && (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("quota"))) {
        setError("API Quota Exceeded (429): Your API key has reached its limit. Please wait a minute or check your Google Cloud billing.");
      } else {
        setError(err.message || "Connection failed. Please check your internet or API key.");
      }
    } finally {
      setIsGenerating(false);
      setLoadingStatus(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setLoadingStatus(null);
    }
  };

  const downloadAudio = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-bottom border-white/5 py-4 px-6 flex items-center justify-between sticky top-0 bg-[#050505]/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
            <Mic2 className="text-black w-6 h-6" />
          </div>
          <span className="text-xl font-bold tracking-tight">Vox AI Studio TTS</span>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowMonetization(!showMonetization)}
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-xl hover:bg-yellow-500/20 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>Premium Plans</span>
          </button>
          
          {user ? (
            <div className="hidden md:flex items-center gap-4 px-4 py-1.5 glass-panel text-sm">
              <div className="flex items-center gap-2 border-r border-white/10 pr-4">
                <span className="opacity-60">Credits:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {user.credits === Infinity ? 'Unlimited' : user.credits.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 border-r border-white/10 pr-4">
                <User className="w-4 h-4 opacity-60" />
                <span className="max-w-[120px] truncate">{user.email}</span>
                {user.email === 'robotlinkan@gmail.com' ? (
                  <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] uppercase tracking-wider rounded-full border border-purple-500/30 font-bold" title="Chief Owner: Robot Linkan">Chief Owner</span>
                ) : user.email === 'sachinamliyar15@gmail.com' ? (
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] uppercase tracking-wider rounded-full border border-emerald-500/30 font-bold" title="Owner: Sachin Amliyar">Owner</span>
                ) : user.isPremium ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" title="Premium User" />
                ) : null}
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-red-400 hover:text-red-300 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden lg:inline">Logout</span>
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-white text-black rounded-xl hover:bg-white/90 font-medium text-sm transition-all"
            >
              <User className="w-4 h-4" />
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Editor */}
        <div className="lg:col-span-8 space-y-6">
          {/* Mode Selector */}
          <div className="flex gap-2 p-1 bg-white/5 rounded-xl w-fit">
            <button 
              onClick={() => setMode('tts')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mode === 'tts' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              <Mic2 className="w-4 h-4" /> Text to Speech
            </button>
            <button 
              onClick={() => setMode('voice_changer')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mode === 'voice_changer' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              <Repeat className="w-4 h-4" /> Voice Changer
            </button>
            <button 
              onClick={() => setMode('dubbing')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mode === 'dubbing' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              <Globe className="w-4 h-4" /> AI Dubbing
            </button>
          </div>

          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-500" />
                {mode === 'tts' ? 'Text to Speech' : mode === 'voice_changer' ? 'Voice Changer (Speech-to-Speech)' : 'AI Dubbing (Translate Audio)'}
              </h2>
              {mode === 'tts' && (
                <span className="text-xs opacity-40 font-mono uppercase tracking-widest">
                  {text.length} / {MAX_CHARS} characters
                </span>
              )}
            </div>
            
            {mode === 'tts' ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste your text here to generate a high-quality AI voice..."
                className="w-full h-64 bg-transparent border-none resize-none focus:ring-0 text-lg leading-relaxed placeholder:opacity-20"
              />
            ) : (
              <div className="space-y-4">
                <div className="w-full h-48 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-4 hover:border-emerald-500/50 transition-colors relative bg-black/20">
                  <input type="file" accept="audio/*" onChange={handleFileUpload} className="absolute inset-0 w-full h-ful
