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
  Globe
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  const [topic, setTopic] = useState('How much does a website cost in Nigeria');
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const runPipeline = () => {
    if (!topic) return;
    
    setIsRunning(true);
    setFinalResult(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s, status: 'idle', data: undefined })));

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/pipeline/stream?topic=${encodeURIComponent(topic)}`);
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
          <NavItem icon={LayoutDashboard} label="Dashboard" active />
          <NavItem icon={FileText} label="Content Calendar" />
          <NavItem icon={Settings} label="Settings" />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-zinc-200 px-8 py-5 flex items-center justify-between shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline Runner</h1>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected to WordPress
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-5xl mx-auto space-y-8">
            
            {/* Input Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200">
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Target Topic or Keyword
              </label>
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
                      <button className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg font-medium transition-colors">
                        Publish to WordPress
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

          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon: Icon, label, active }: { icon: any, label: string, active?: boolean }) {
  return (
    <button className={cn(
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
