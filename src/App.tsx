import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  LayoutDashboard, 
  FileText, 
  Play, 
  CheckCircle2, 
  CircleDashed, 
  Loader2,
  Image as ImageIcon,
  Search,
  ListTree,
  Tags,
  Globe,
  Sparkles
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type StepStatus = 'idle' | 'running' | 'completed' | 'failed';

interface PipelineStep {
  id: string;
  name: string;
  icon: React.ElementType;
  status: StepStatus;
  data?: any;
}

const INITIAL_STEPS: PipelineStep[] = [
  { id: 'keyword_research', name: 'Keyword Research', icon: Search, status: 'idle' },
  { id: 'content_outline', name: 'Content Outline', icon: ListTree, status: 'idle' },
  { id: 'content_draft', name: 'Article Draft', icon: FileText, status: 'idle' },
  { id: 'featured_image', name: 'Featured Image', icon: ImageIcon, status: 'idle' },
  { id: 'seo_meta', name: 'SEO & Meta Data', icon: Tags, status: 'idle' },
];

export default function App() {
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar' | 'settings'>('dashboard');
  const [topic, setTopic] = useState('How much does a website cost in Nigeria');
  
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [textModel, setTextModel] = useState('gemini-3.1-flash-preview');
  const [imageModel, setImageModel] = useState('gemini-3.1-flash-image-preview');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [finalResult, setFinalResult] = useState<any>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        setHasApiKey(true); // Fallback if not in AI Studio
      }
    };
    checkApiKey();
  }, []);

  const handleSelectApiKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success to mitigate race condition
    }
  };

  const [apiKeys, setApiKeys] = useState(() => {
    const saved = localStorage.getItem('autoblog_api_keys');
    const parsed = saved ? JSON.parse(saved) : {};
    return { 
      gemini: '', openai: '', anthropic: '', 
      wpUrl: '', wpUser: '', wpPassword: '', 
      ...parsed 
    };
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      const apiKey = provider === 'gemini' ? apiKeys.gemini : apiKeys.openai;
      if (!apiKey) {
        setAvailableModels([]);
        return;
      }
      setIsLoadingModels(true);
      try {
        const res = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey })
        });
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
          if (!data.models.includes(textModel)) {
            setTextModel(data.models[0]);
          }
        } else {
          setAvailableModels([]);
        }
      } catch (e) {
        console.error("Failed to fetch models", e);
        setAvailableModels([]);
      }
      setIsLoadingModels(false);
    };

    fetchModels();
  }, [provider, apiKeys.gemini, apiKeys.openai]);

  const saveApiKeys = (keys: any) => {
    setApiKeys(keys);
    localStorage.setItem('autoblog_api_keys', JSON.stringify(keys));
  };

  const publishToWordPress = async () => {
    if (!apiKeys.wpUrl || !apiKeys.wpUser || !apiKeys.wpPassword) {
      alert("Please configure your WordPress credentials in the Settings tab first.");
      setActiveTab('settings');
      return;
    }

    setIsPublishing(true);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalResult?.outline?.post_title || topic,
          content: finalResult?.draft,
          wpUrl: apiKeys.wpUrl,
          wpUser: apiKeys.wpUser,
          wpPassword: apiKeys.wpPassword,
          imageBase64: finalResult?.image
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Successfully published to WordPress as Draft! URL: ' + data.url);
      } else {
        alert('Failed to publish: ' + data.error);
      }
    } catch (e: any) {
      alert('Error publishing: ' + e.message);
    }
    setIsPublishing(false);
  };

  const generateTopics = async () => {
    setIsGeneratingTopics(true);
    try {
      const apiKey = provider === 'gemini' ? apiKeys.gemini : apiKeys.openai;
      const res = await fetch(`/api/topics/generate?provider=${provider}&model=${encodeURIComponent(textModel)}&apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();
      if (data.topics && Array.isArray(data.topics)) {
        setSuggestedTopics(data.topics);
      } else {
        alert('Failed to generate topics: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error generating topics: ' + e.message);
    }
    setIsGeneratingTopics(false);
  };

  const runPipeline = () => {
    if (!topic) return;
    
    setIsRunning(true);
    setFinalResult(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s, status: 'idle', data: undefined })));

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const apiKey = provider === 'gemini' ? apiKeys.gemini : apiKeys.openai;
    const es = new EventSource(`/api/pipeline/stream?topic=${encodeURIComponent(topic)}&provider=${provider}&textModel=${encodeURIComponent(textModel)}&imageModel=${encodeURIComponent(imageModel)}&apiKey=${encodeURIComponent(apiKey)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const { step, status, data } = JSON.parse(event.data);
      
      if (step === 'pipeline' && status === 'finished') {
        setFinalResult(data);
        setIsRunning(false);
        es.close();
        return;
      }

      if (step === 'error') {
        setIsRunning(false);
        es.close();
        alert(`Pipeline Error: ${data.message}`);
        return;
      }

      setSteps(prev => prev.map(s => {
        if (s.id === step) {
          return { ...s, status: status as StepStatus, data: data || s.data };
        }
        return s;
      }));
    };

    es.onerror = () => {
      setIsRunning(false);
      es.close();
    };
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 flex font-sans text-zinc-900">
      {hasApiKey === false && provider === 'gemini' && (imageModel === 'gemini-3.1-flash-image-preview' || imageModel === 'gemini-3-pro-image-preview') && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-4">API Key Required</h2>
            <p className="text-zinc-600 mb-6">
              To use the advanced Gemini Image Preview models, you must select your own Google Cloud API key with billing enabled.
              <br /><br />
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                Learn more about billing
              </a>
            </p>
            <button
              onClick={handleSelectApiKey}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-4 rounded-xl transition-colors"
            >
              Select API Key
            </button>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-950 text-zinc-300 flex flex-col">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-white font-bold text-xl tracking-tight">
            <Globe className="w-6 h-6 text-emerald-500" />
            AutoBlog Pro
          </div>
          <p className="text-xs text-zinc-500 mt-1">Headless WP Engine</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <NavItem icon={LayoutDashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={FileText} label="Content Calendar" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <NavItem icon={Settings} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-zinc-200 px-8 py-5 flex items-center justify-between shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {activeTab === 'dashboard' && 'Pipeline Runner'}
            {activeTab === 'calendar' && 'Content Calendar'}
            {activeTab === 'settings' && 'Settings'}
          </h1>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected to WordPress
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-5xl mx-auto space-y-8">
            
            {activeTab === 'settings' && (
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200">
                <h2 className="text-xl font-semibold mb-6">API Configuration</h2>
                <p className="text-zinc-500 mb-8 text-sm">
                  Configure your API keys here. These keys are stored locally in your browser. 
                  Alternatively, you can configure the Gemini API key in the AI Studio Secrets panel.
                </p>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">Gemini API Key</label>
                    <input
                      type="password"
                      value={apiKeys.gemini}
                      onChange={(e) => saveApiKeys({ ...apiKeys, gemini: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="AIzaSy..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">OpenAI API Key (Optional)</label>
                    <input
                      type="password"
                      value={apiKeys.openai}
                      onChange={(e) => saveApiKeys({ ...apiKeys, openai: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="sk-..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">Anthropic API Key (Optional)</label>
                    <input
                      type="password"
                      value={apiKeys.anthropic}
                      onChange={(e) => saveApiKeys({ ...apiKeys, anthropic: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="sk-ant-..."
                    />
                  </div>

                  <hr className="border-zinc-200 my-8" />
                  <h2 className="text-xl font-semibold mb-6">WordPress Configuration</h2>
                  
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">WordPress Site URL</label>
                    <input
                      type="url"
                      value={apiKeys.wpUrl}
                      onChange={(e) => saveApiKeys({ ...apiKeys, wpUrl: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="https://your-site.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">WordPress Username</label>
                    <input
                      type="text"
                      value={apiKeys.wpUser}
                      onChange={(e) => saveApiKeys({ ...apiKeys, wpUser: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="admin"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">Application Password</label>
                    <input
                      type="password"
                      value={apiKeys.wpPassword}
                      onChange={(e) => saveApiKeys({ ...apiKeys, wpPassword: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="xxxx xxxx xxxx xxxx"
                    />
                    <p className="text-xs text-zinc-500 mt-2">Generate this in your WordPress Admin &gt; Users &gt; Profile &gt; Application Passwords.</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 flex flex-col items-center justify-center h-96 text-zinc-400">
                <FileText className="w-12 h-12 mb-4 stroke-1" />
                <p>Content Calendar module is coming soon.</p>
              </div>
            )}

            {activeTab === 'dashboard' && (
              <>
                {/* AI Configuration Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 mb-8">
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">AI Configuration</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-2">Provider</label>
                      <select 
                        value={provider}
                        onChange={(e) => {
                          setProvider(e.target.value as 'gemini' | 'openai');
                          if (e.target.value === 'openai') {
                            setImageModel('dall-e-3');
                          } else {
                            setImageModel('gemini-3.1-flash-image-preview');
                          }
                        }}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-2">
                        Text Model {isLoadingModels && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}
                      </label>
                      <select 
                        value={textModel}
                        onChange={(e) => setTextModel(e.target.value)}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      >
                        {availableModels.length > 0 ? (
                          availableModels.map(m => <option key={m} value={m}>{m}</option>)
                        ) : (
                          <option value={textModel}>{textModel}</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-2">Image Model</label>
                      <select 
                        value={imageModel}
                        onChange={(e) => setImageModel(e.target.value)}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      >
                        {provider === 'gemini' ? (
                          <>
                            <option value="gemini-3.1-flash-image-preview">gemini-3.1-flash-image-preview</option>
                            <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview</option>
                            <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
                          </>
                        ) : (
                          <>
                            <option value="dall-e-3">dall-e-3</option>
                            <option value="dall-e-2">dall-e-2</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>
                  {((provider === 'gemini' && !apiKeys.gemini) || (provider === 'openai' && !apiKeys.openai)) && (
                    <p className="text-sm text-amber-600 mt-3">
                      ⚠️ Please configure your {provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key in the Settings tab.
                    </p>
                  )}
                </div>

                {/* Input Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-zinc-700">
                  Target Topic or Keyword
                </label>
                <button 
                  onClick={generateTopics} 
                  disabled={isGeneratingTopics || isRunning}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 disabled:opacity-50"
                >
                  {isGeneratingTopics ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {isGeneratingTopics ? 'Researching...' : 'Suggest Trending Topics'}
                </button>
              </div>
              <div className="flex gap-4">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={isRunning}
                  className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50"
                  placeholder="e.g. Best website builders for Nigerian small businesses"
                />
                <button
                  onClick={runPipeline}
                  disabled={isRunning || !topic}
                  className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunning ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                  {isRunning ? 'Generating...' : 'Start Pipeline'}
                </button>
              </div>
              {suggestedTopics.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {suggestedTopics.map((t, i) => (
                    <button 
                      key={i}
                      onClick={() => setTopic(t)}
                      className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full hover:bg-emerald-100 transition-colors text-left"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Pipeline Steps */}
              <div className="lg:col-span-1 space-y-4">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Execution Steps</h2>
                {steps.map((step, index) => (
                  <div 
                    key={step.id}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border transition-all duration-300",
                      step.status === 'running' ? "bg-emerald-50 border-emerald-200 shadow-sm" : 
                      step.status === 'completed' ? "bg-white border-zinc-200" : 
                      "bg-zinc-50/50 border-transparent opacity-60"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      step.status === 'running' ? "bg-emerald-100 text-emerald-600" :
                      step.status === 'completed' ? "bg-zinc-100 text-zinc-600" :
                      "bg-zinc-200 text-zinc-400"
                    )}>
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : step.status === 'running' ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <step.icon className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <p className={cn(
                        "font-medium text-sm",
                        step.status === 'running' ? "text-emerald-900" : "text-zinc-900"
                      )}>
                        {step.name}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {step.status === 'idle' ? 'Waiting...' : 
                         step.status === 'running' ? 'Processing with AI...' : 
                         'Completed successfully'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Live Preview */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 h-[600px] flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-zinc-700">Live Preview</h2>
                    {finalResult && (
                      <button 
                        onClick={publishToWordPress}
                        disabled={isPublishing}
                        className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {isPublishing ? 'Publishing...' : 'Publish to WordPress'}
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto p-8">
                    {!steps.some(s => s.status !== 'idle') && !finalResult ? (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                        <CircleDashed className="w-12 h-12 stroke-1" />
                        <p>Start the pipeline to see the generated content.</p>
                      </div>
                    ) : (
                      <div className="space-y-8 max-w-2xl mx-auto">
                        {/* Image Preview */}
                        {steps.find(s => s.id === 'featured_image')?.data?.url && (
                          <img 
                            src={steps.find(s => s.id === 'featured_image')?.data?.url} 
                            alt="Featured" 
                            className="w-full aspect-video object-cover rounded-xl shadow-sm"
                          />
                        )}
                        
                        {/* Title Preview */}
                        {steps.find(s => s.id === 'content_outline')?.data?.post_title && (
                          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 leading-tight">
                            {steps.find(s => s.id === 'content_outline')?.data?.post_title}
                          </h1>
                        )}

                        {/* Meta Preview */}
                        {steps.find(s => s.id === 'keyword_research')?.data?.primary_keyword && (
                          <div className="flex items-center gap-4 text-sm text-zinc-500">
                            <span className="flex items-center gap-1.5 bg-zinc-100 px-2.5 py-1 rounded-md">
                              <Search className="w-3.5 h-3.5" />
                              {steps.find(s => s.id === 'keyword_research')?.data?.primary_keyword}
                            </span>
                          </div>
                        )}

                        {/* Content Preview */}
                        {steps.find(s => s.id === 'content_draft')?.data?.html && (
                          <div 
                            className="prose prose-zinc prose-emerald max-w-none prose-headings:font-semibold prose-h2:text-2xl prose-h3:text-xl prose-p:leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: steps.find(s => s.id === 'content_draft')?.data?.html }}
                          />
                        )}

                        {steps.find(s => s.id === 'content_draft')?.status === 'running' && (
                          <div className="space-y-4 animate-pulse">
                            <div className="h-4 bg-zinc-200 rounded w-3/4"></div>
                            <div className="h-4 bg-zinc-200 rounded w-full"></div>
                            <div className="h-4 bg-zinc-200 rounded w-5/6"></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            </>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
      active 
        ? "bg-zinc-900 text-white" 
        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
    )}>
      <Icon className="w-5 h-5" />
      {label}
    </button>
  );
}
