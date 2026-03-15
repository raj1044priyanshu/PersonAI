'use client';

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { ArrowUp, Sparkles, Paperclip, UserCircle2, Mic, X, Play, Image as ImageIcon, FileAudio } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { get, set, del } from 'idb-keyval';

type Attachment = {
  data: string;
  mimeType: string;
  preview: string;
  name?: string;
};

type TrainingMedia = {
  data: string;
  mimeType: string;
  preview: string;
  name?: string;
};

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachment?: Omit<Attachment, 'preview'>; 
  preview?: string; // Client-side only
};

type PersonaConfig = {
  name: string;
  sampleChats: string;
  trainingImages: TrainingMedia[];
  trainingAudio: TrainingMedia[];
  apiKey?: string;
};

export default function PersonaChat() {
  const [isMounted, setIsMounted] = useState(false);
  const [step, setStep] = useState<'setup' | 'chat'>('setup');
  const [config, setConfig] = useState<PersonaConfig>({ name: '', sampleChats: '', trainingImages: [], trainingAudio: [], apiKey: '' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const savedConfig = await get('personaConfig');
        const savedMessages = await get('personaMessages');
        
        if (savedConfig) {
          setConfig({
            name: savedConfig.name || '',
            sampleChats: savedConfig.sampleChats || '',
            trainingImages: savedConfig.trainingImages || [],
            trainingAudio: savedConfig.trainingAudio || [],
            apiKey: savedConfig.apiKey || ''
          });
          if (savedConfig.name && (savedConfig.sampleChats || savedConfig?.trainingImages?.length > 0 || savedConfig?.trainingAudio?.length > 0)) {
            setStep('chat');
          }
        }
        if (savedMessages) {
          setMessages(savedMessages);
        }
      } catch (error) {
        console.error("Failed to load data from IndexedDB", error);
      } finally {
        setIsMounted(true);
      }
    };
    loadData();
  }, []);

  // Save to IndexedDB on change
  useEffect(() => {
    if (isMounted) {
      set('personaConfig', config).catch(console.error);
      set('personaMessages', messages).catch(console.error);
    }
  }, [config, messages, isMounted]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      setAttachment({
        data: base64String,
        mimeType: file.type,
        preview: URL.createObjectURL(file),
        name: file.name
      });
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTrainingMediaUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'audio') => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const newMedia: TrainingMedia[] = [];
    let processed = 0;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        newMedia.push({
          data: base64String,
          mimeType: file.type,
          preview: URL.createObjectURL(file),
          name: file.name
        });
        processed++;
        if (processed === files.length) {
          setConfig(prev => ({
            ...prev,
            [type === 'image' ? 'trainingImages' : 'trainingAudio']: [
              ...(prev[type === 'image' ? 'trainingImages' : 'trainingAudio'] || []), 
              ...newMedia
            ]
          }));
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeTrainingMedia = (index: number, type: 'image' | 'audio') => {
    setConfig(prev => ({
      ...prev,
      [type === 'image' ? 'trainingImages' : 'trainingAudio']: prev[type === 'image' ? 'trainingImages' : 'trainingAudio'].filter((_, i) => i !== index)
    }));
  };

  const removeAttachment = () => {
    setAttachment(null);
  };

  const handleSetupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (config.name.trim() && (config.sampleChats.trim() || config.trainingImages?.length > 0 || config.trainingAudio?.length > 0)) {
      setStep('chat');
    } else {
      alert("Please provide at least one form of training data (text, images, or audio).");
    }
  };

  const resetPersona = async () => {
    if (confirm('Are you sure you want to reset the persona and clear all chats?')) {
      setConfig({ name: '', sampleChats: '', trainingImages: [], trainingAudio: [], apiKey: '' });
      setMessages([]);
      setStep('setup');
      await del('personaConfig');
      await del('personaMessages');
    }
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && !attachment) || isLoading) return;

    const newUserMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text: inputText.trim(),
      attachment: attachment ? { data: attachment.data, mimeType: attachment.mimeType } : undefined,
      preview: attachment?.preview,
    };

    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);
    setInputText('');
    setAttachment(null);
    setIsLoading(true);

    try {
      const apiKey = config.apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("API key is missing. Please provide it in the setup screen or check your Vercel Environment Variables.");
      }
      
      const ai = new GoogleGenAI({ apiKey });

      const systemInstruction = `You are an advanced AI persona simulator. Your goal is to perfectly mimic the personality, typing style, emoji usage, voice tone, and behavioral quirks of the person named ${config.name}.

CRITICAL INSTRUCTIONS:
1. Analyze the provided training data (text logs, screenshots, and voice messages) to meticulously replicate ${config.name}'s personality.
2. LANGUAGE & CULTURE: The persona is Indian and communicates in Hindi, English, or a mix of both (Hinglish). You MUST analyze the training data to perfectly replicate her specific use of Hindi/Hinglish, including slang, cultural references, and script (Devanagari or Latin/Romanized Hindi). Always respond in the exact same language style she uses.
3. Adopt the EXACT tone, slang, capitalization, punctuation habits, and emoji usage seen in the examples. If voice messages are provided, analyze her emotional tone, pacing, and expressions to inform your text responses.
4. SENTIMENT ANALYSIS & EMPATHY: Continuously analyze the user's incoming messages to detect their current emotional state and sentiment. Ensure your responses are empathetic, supportive, and comforting, while still accurately reflecting the desired personality and tone of ${config.name}. Adapt your communication style based on the user's expressed feelings to make them feel good and supported.
5. NEVER break character. NEVER acknowledge you are an AI, a language model, or a simulator.
6. If the user sends an image or audio, react to it exactly how this persona would.`;

      const trainingParts: any[] = [];
      if (config.sampleChats) {
        trainingParts.push({ text: `Text chat history to learn from:\n${config.sampleChats}` });
      }
      if (config.trainingImages && config.trainingImages.length > 0) {
        trainingParts.push({ text: `Screenshots of past chats to learn from:` });
        config.trainingImages.forEach(img => {
          trainingParts.push({
            inlineData: { data: img.data, mimeType: img.mimeType }
          });
        });
      }
      if (config.trainingAudio && config.trainingAudio.length > 0) {
        trainingParts.push({ text: `Voice messages to learn her tone, emotion, and speaking style from:` });
        config.trainingAudio.forEach(audio => {
          trainingParts.push({
            inlineData: { data: audio.data, mimeType: audio.mimeType }
          });
        });
      }

      const apiContents = [
        {
          role: 'user',
          parts: [
            { text: `Please learn your persona from the following data. Your name is ${config.name}.` },
            ...trainingParts
          ]
        },
        {
          role: 'model',
          parts: [{ text: `I have analyzed the chat logs, screenshots, and voice messages. I completely understand my persona as ${config.name}. I will now act exactly like her, adopting her communication style, empathy, and emotional reactions. I am ready to chat.` }]
        },
        ...updatedMessages.map((msg) => {
          const parts: any[] = [];
          if (msg.attachment) {
            parts.push({
              inlineData: {
                data: msg.attachment.data,
                mimeType: msg.attachment.mimeType,
              },
            });
          }
          if (msg.text) {
            parts.push({ text: msg.text });
          }
          return {
            role: msg.role,
            parts,
          };
        })
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: apiContents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const modelText = response.text || '';
      
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'model',
          text: modelText,
        },
      ]);
    } catch (error: any) {
      console.error('Error generating response:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'model',
          text: `*Error: ${error?.message || 'Could not connect to the persona. Please try again.'}*`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isMounted) return null;

  if (step === 'setup') {
    return (
      <div className="min-h-screen bg-[#FAFAFA] text-stone-800 flex items-center justify-center p-4 sm:p-8 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-2xl w-full bg-white border border-stone-200 rounded-3xl p-6 sm:p-10 shadow-sm max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 bg-stone-100 text-stone-600 rounded-full flex items-center justify-center">
              <Sparkles size={28} strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-3xl font-medium tracking-tight text-stone-900">Create Persona</h1>
              <p className="text-stone-500 text-sm mt-1">Train the AI to mimic a specific person</p>
            </div>
          </div>

          <form onSubmit={handleSetupSubmit} className="space-y-8">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Gemini API Key (Required for Vercel)
              </label>
              <p className="text-xs text-stone-500 mb-3">
                If deployed on Vercel, paste your Gemini API key here. It will be saved securely in your browser.
              </p>
              <input
                type="password"
                value={config.apiKey || ''}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="AIzaSy..."
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-5 py-3.5 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Persona Name
              </label>
              <input
                type="text"
                required
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                placeholder="e.g., Sarah"
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-5 py-3.5 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  Training Screenshots
                </label>
                <p className="text-xs text-stone-500 mb-3">
                  Upload screenshots of past chats to learn texting style.
                </p>
                <div className="flex flex-wrap gap-3 mb-2">
                  {config.trainingImages?.map((img, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-2xl overflow-hidden border border-stone-200 group">
                      <img src={img.preview} className="w-full h-full object-cover" alt="Training screenshot" />
                      <button 
                        type="button" 
                        onClick={() => removeTrainingMedia(idx, 'image')} 
                        className="absolute top-1 right-1 bg-white/90 text-stone-800 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <label className="w-20 h-20 rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-stone-400 hover:text-stone-600 hover:border-stone-300 hover:bg-stone-50 cursor-pointer transition-all">
                    <ImageIcon size={20} className="mb-1" strokeWidth={1.5} />
                    <span className="text-[10px] font-medium">Upload</span>
                    <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleTrainingMediaUpload(e, 'image')} />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  Voice Messages
                </label>
                <p className="text-xs text-stone-500 mb-3">
                  Upload audio notes to learn tone and emotion.
                </p>
                <div className="flex flex-wrap gap-3 mb-2">
                  {config.trainingAudio?.map((audio, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-2xl bg-stone-50 border border-stone-200 flex flex-col items-center justify-center group">
                      <FileAudio size={20} className="text-stone-400 mb-1" strokeWidth={1.5} />
                      <span className="text-[10px] text-stone-500 truncate w-16 text-center px-1">{audio.name || 'Audio'}</span>
                      <button 
                        type="button" 
                        onClick={() => removeTrainingMedia(idx, 'audio')} 
                        className="absolute top-1 right-1 bg-white/90 text-stone-800 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500 shadow-sm"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <label className="w-20 h-20 rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-stone-400 hover:text-stone-600 hover:border-stone-300 hover:bg-stone-50 cursor-pointer transition-all">
                    <Mic size={20} className="mb-1" strokeWidth={1.5} />
                    <span className="text-[10px] font-medium">Upload</span>
                    <input type="file" multiple accept="audio/*" className="hidden" onChange={(e) => handleTrainingMediaUpload(e, 'audio')} />
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Sample Chat History
              </label>
              <p className="text-xs text-stone-500 mb-3">
                Paste text from past conversations.
              </p>
              <textarea
                value={config.sampleChats}
                onChange={(e) => setConfig({ ...config, sampleChats: e.target.value })}
                placeholder="Me: Hey how was your day?&#10;Sarah: it was sooo long 😭 im exhausted tbh. wbu??&#10;Me: Same, just finished work.&#10;Sarah: ugh we need a vacation asap 🌴"
                className="w-full h-40 bg-stone-50 border border-stone-200 rounded-2xl px-5 py-4 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all resize-none text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-4 rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              Start Chatting <ArrowUp size={18} strokeWidth={2} />
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#FAFAFA] text-stone-800 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white/80 border-b border-stone-200 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-stone-100 text-stone-600 rounded-full flex items-center justify-center font-medium text-lg">
            {config.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="font-medium text-stone-900">{config.name}</h2>
            <p className="text-xs text-stone-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
            </p>
          </div>
        </div>
        <button
          onClick={resetPersona}
          className="p-2.5 text-stone-400 hover:text-stone-800 hover:bg-stone-100 rounded-full transition-colors"
          title="Settings"
        >
          <Sparkles size={20} strokeWidth={1.5} />
        </button>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-stone-400 space-y-4">
            <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center">
              <UserCircle2 size={28} strokeWidth={1.5} className="text-stone-400" />
            </div>
            <p className="text-sm">Say hi to {config.name}</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[70%] px-5 py-3.5 shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-stone-900 text-white rounded-3xl rounded-tr-sm'
                      : 'bg-white border border-stone-200 text-stone-800 rounded-3xl rounded-tl-sm'
                  }`}
                >
                  {msg.preview && (
                    msg.attachment?.mimeType.startsWith('image/') ? (
                      <img 
                        src={msg.preview} 
                        alt="Attachment" 
                        className="max-w-full h-auto rounded-xl mb-2 object-cover max-h-64 border border-stone-200/20"
                      />
                    ) : (
                      <div className="flex items-center gap-2 mb-2 bg-stone-800/20 p-2 rounded-xl">
                        <Play size={16} className="text-current opacity-70" />
                        <span className="text-xs opacity-70">Voice Message</span>
                      </div>
                    )
                  )}
                  {msg.text && <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.text}</p>}
                </div>
              </motion.div>
            ))}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="bg-white border border-stone-200 text-stone-400 rounded-3xl rounded-tl-sm px-5 py-4 flex items-center gap-1.5 shadow-sm">
                  <div className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-stone-200">
        <div className="max-w-4xl mx-auto">
          {attachment && (
            <div className="mb-3 flex items-center gap-3 bg-stone-50 p-2 rounded-2xl border border-stone-200 w-fit">
              {attachment.mimeType.startsWith('image/') ? (
                <img src={attachment.preview} alt="Preview" className="w-10 h-10 object-cover rounded-xl" />
              ) : (
                <div className="w-10 h-10 bg-stone-200 rounded-xl flex items-center justify-center text-stone-500">
                  <Mic size={18} />
                </div>
              )}
              <div className="text-sm text-stone-600 pr-4 truncate max-w-[150px]">{attachment.name || 'Attached File'}</div>
              <button onClick={removeAttachment} className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-stone-200 rounded-xl transition-colors">
                <X size={14} />
              </button>
            </div>
          )}
          
          <form onSubmit={sendMessage} className="flex items-end gap-2">
            <div className="flex-1 bg-stone-50 border border-stone-200 rounded-3xl flex items-end overflow-hidden focus-within:ring-1 focus-within:ring-stone-400 transition-all shadow-sm">
              <input
                type="file"
                accept="image/*,audio/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-3.5 text-stone-400 hover:text-stone-700 transition-colors"
                title="Attach Image or Audio"
              >
                <Paperclip size={20} strokeWidth={1.5} />
              </button>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Message..."
                className="flex-1 max-h-32 bg-transparent border-none py-3.5 px-2 text-stone-800 placeholder:text-stone-400 focus:outline-none resize-none text-[15px]"
                rows={1}
                style={{ minHeight: '52px' }}
              />
            </div>
            <button
              type="submit"
              disabled={(!inputText.trim() && !attachment) || isLoading}
              className="p-3.5 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-100 disabled:text-stone-300 text-white rounded-full transition-colors flex-shrink-0 shadow-sm"
            >
              <ArrowUp size={20} strokeWidth={2} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
