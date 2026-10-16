import React, { useState, useRef, useEffect, Component } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send,
  Bot,
  User,
  Loader2,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  X,
  Sparkles,
  Trash2,
  Database,
} from 'lucide-react';

// Required ErrorBoundary to catch ReactMarkdown v10+ crash parsing errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="text-[#d93025] text-xs p-2">
          MD Err: {this.state.error?.message}
        </div>
      );
    }
    return this.props.children;
  }
}

const INITIAL_SUGGESTIONS = [
  'Quais usuários possuem acesso à empresa (bukrs) 1010 e 1710?',
  'Quais tabelas do dataset Raw já estão com política de RLS aplicada?',
  'Quais roles do SAP (PFCG) têm mais regras organizacionais na agr_1252?',
];

export default function ChatPanel({ isOpen, onClose, contextText }) {
  const [messages, setMessages] = useState([
    {
      role: 'model',
      content:
        'Olá! Sou o **Assistente Gemini Data Analytics** conectado às tabelas de governança e segurança SAP no BigQuery (`sec_user_org_entitlements`, `sec_rls_audit_log`, `agr_*`, `usr02`, `adr6`, `bkpf`).\n\nComo posso ajudar você a auditar ou explorar as permissões hoje?',
      thoughts: '',
      suggestions: INITIAL_SUGGESTIONS,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedThoughts, setExpandedThoughts] = useState({});
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(scrollHeight, 112) + 'px';
      textareaRef.current.style.overflowY = scrollHeight > 112 ? 'auto' : 'hidden';
    }
  }, [input]);

  const toggleThought = (idx) => {
    setExpandedThoughts((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        role: 'model',
        content:
          'Conversa reiniciada. Faça uma pergunta em linguagem natural sobre as roles SAP, matrizes de acesso ou políticas de RLS no BigQuery!',
        thoughts: '',
        suggestions: INITIAL_SUGGESTIONS,
      },
    ]);
    setExpandedThoughts({});
  };

  const handleSend = async (e, overrideText = null) => {
    e?.preventDefault();
    const textToSend = overrideText || input;
    if (!textToSend.trim() || isLoading) return;

    if (!overrideText) setInput('');
    setIsLoading(true);

    const currentMessages = [
      ...messages,
      { role: 'user', content: textToSend.trim() },
    ];

    const nextIdx = currentMessages.length;
    let thinking = '';
    let reply = '';
    let suggestions = [];

    setMessages([
      ...currentMessages,
      { role: 'model', content: '', thoughts: '', suggestions: [] },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: contextText
            ? `[Context: ${contextText}] ${textToSend.trim()}`
            : textToSend.trim(),
          history: currentMessages.slice(0, -1),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        setIsLoading(false);
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') break;
            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === 'THOUGHT') {
                  thinking += parsed.content + '\n';
                } else if (parsed.type === 'SUGGESTION') {
                  if (!suggestions.includes(parsed.content)) {
                    suggestions.push(parsed.content);
                  }
                } else {
                  reply += parsed.content;
                }

                setMessages((prev) => {
                  const updated = [...prev];
                  updated[nextIdx] = {
                    role: 'model',
                    content: reply,
                    thoughts: thinking,
                    suggestions: [...suggestions],
                  };
                  return updated;
                });
              } catch (parseErr) {
                console.error('JSON parse fail:', dataStr, parseErr);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([
        ...currentMessages,
        {
          role: 'model',
          content: `⚠️ Erro ao comunicar com o Assistente Gemini Data Analytics: ${error.message}`,
          thoughts: thinking,
          suggestions: INITIAL_SUGGESTIONS,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[450px] bg-white dark:bg-[#0c0c0f] border-l border-[#dadce0] dark:border-zinc-800 shadow-2xl flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#dadce0] dark:border-zinc-800 bg-[#f8f9fa] dark:bg-zinc-900">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#e8f0fe] dark:bg-blue-950 flex items-center justify-center border border-[#d2e3fc] dark:border-blue-800">
            <Sparkles className="w-4 h-4 text-[#1a73e8] dark:text-blue-400" />
          </div>
          <div>
            <div className="font-bold text-sm text-[#202124] dark:text-white flex items-center gap-1.5">
              <span>Assistente Gemini IA</span>
              <span className="px-1.5 py-0.5 rounded bg-[#e8f0fe] text-[#1a73e8] dark:bg-blue-900/50 dark:text-blue-300 font-mono text-[10px]">
                BigQuery
              </span>
            </div>
            <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 flex items-center gap-1">
              <Database className="w-3 h-3" />
              <span>Consultas em linguagem natural sobre SAP & RLS</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClearChat}
            className="p-1.5 rounded-lg hover:bg-[#e8eaed] dark:hover:bg-zinc-800 text-[#5f6368] dark:text-zinc-400 transition-colors"
            title="Limpar histórico de conversa"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#e8eaed] dark:hover:bg-zinc-800 text-[#5f6368] hover:text-[#202124] dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            title="Fechar painel Gemini"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Stream Container */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-white dark:bg-[#0c0c0f]">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-2.5 ${
              m.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            <div
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border ${
                m.role === 'user'
                  ? 'bg-[#1a73e8] border-[#1557b0] text-white'
                  : 'bg-[#e8f0fe] dark:bg-zinc-800 border-[#d2e3fc] dark:border-zinc-700 text-[#1a73e8] dark:text-blue-400'
              }`}
            >
              {m.role === 'user' ? (
                <User className="w-3.5 h-3.5" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>

            <div className="max-w-[86%] flex flex-col gap-2">
              {/* 1. Thoughts Box (Collapsible & Separate from Final Response) */}
              {m.role === 'model' && m.thoughts && m.thoughts.trim().length > 0 && (
                <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleThought(i)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#5f6368] dark:text-zinc-400 hover:text-[#202124] dark:hover:text-zinc-200 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800/60 transition-colors"
                  >
                    {expandedThoughts[i] ? (
                      <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <BrainCircuit className="w-3.5 h-3.5 text-[#1a73e8] dark:text-blue-400 flex-shrink-0" />
                    <span className="truncate text-left">
                      {(() => {
                        if (m.content && m.content.length > 0) {
                          return 'Ver processo de raciocínio e consulta BigQuery';
                        }
                        const lines = m.thoughts
                          .split('\n')
                          .filter((l) => l.trim().length > 0);
                        return lines.length > 0
                          ? lines[lines.length - 1]
                          : 'Analisando metadados SAP no BigQuery...';
                      })()}
                    </span>
                  </button>

                  {expandedThoughts[i] && (
                    <div className="px-3 pb-3 pt-2.5 border-t border-[#dadce0] dark:border-zinc-800 max-h-[240px] overflow-y-auto bg-[#f1f3f4]/70 dark:bg-zinc-950 text-[11px] font-mono leading-relaxed text-[#5f6368] dark:text-zinc-400 flex flex-col gap-1.5">
                      {m.thoughts
                        .split('\n')
                        .filter((l) => l.trim().length > 0)
                        .map((line, idx) => (
                          <div key={idx} className="flex gap-2 items-start">
                            <div className="text-[#1a73e8] dark:text-blue-400 mt-[1px]">›</div>
                            <div className="break-words whitespace-pre-wrap">{line}</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* 2. Loading Pulse (Wait State) */}
              {m.role === 'model' && !m.content && !expandedThoughts[i] && (
                <div className="flex items-center gap-2 text-xs text-[#5f6368] dark:text-zinc-400 italic ml-1 mb-1 p-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1a73e8]" />
                  <span>
                    {m.thoughts
                      ? 'Executando análise no BigQuery...'
                      : 'Conectando ao Gemini Data Analytics...'}
                  </span>
                </div>
              )}

              {/* 3. FINAL_RESPONSE Rendering (Markdown) */}
              {m.content && (
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#1a73e8] text-white rounded-tr-none shadow-sm'
                      : 'bg-[#f8f9fa] dark:bg-zinc-900 text-[#202124] dark:text-zinc-200 rounded-tl-none border border-[#dadce0] dark:border-zinc-800 shadow-sm'
                  }`}
                >
                  {m.role === 'model' ? (
                    <ErrorBoundary>
                      {/* Place className on parent div, NOT on ReactMarkdown for v10+ compatibility */}
                      <div className="[&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:list-disc [&>ul]:ml-4 [&>ul]:mb-2 [&>h3]:font-bold [&>h3]:text-xs [&>h3]:text-[#202124] dark:[&>h3]:text-zinc-100 [&>h3]:mb-1.5 [&>h3]:mt-2 [&>ol]:list-decimal [&>ol]:ml-4 [&_code]:font-mono [&_code]:bg-black/5 dark:[&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:bg-[#e8f0fe] dark:[&_th]:bg-zinc-800 [&_th]:text-[#1a73e8] dark:[&_th]:text-blue-300 [&_th]:p-1.5 [&_th]:text-left [&_th]:border [&_th]:border-[#dadce0] dark:[&_th]:border-zinc-700 [&_td]:p-1.5 [&_td]:border [&_td]:border-[#dadce0] dark:[&_td]:border-zinc-800 overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    </ErrorBoundary>
                  ) : (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  )}
                </div>
              )}

              {/* 4. Smart Follow-Up Suggestions Rendering */}
              {m.role === 'model' &&
                m.suggestions &&
                m.suggestions.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-1">
                    {m.suggestions.slice(0, 3).map((s, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSend(null, s)}
                        disabled={isLoading}
                        className="text-left text-xs bg-[#e8f0fe]/70 dark:bg-blue-950/40 hover:bg-[#d2e3fc] dark:hover:bg-blue-900/60 text-[#1a73e8] dark:text-blue-300 px-3 py-2 rounded-lg border border-[#d2e3fc] dark:border-blue-800/50 transition-colors disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Multiline Auto-Resizing Input Form */}
      <form
        onSubmit={handleSend}
        className="p-3.5 border-t border-[#dadce0] dark:border-zinc-800 flex items-end bg-[#f8f9fa] dark:bg-zinc-900 relative"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="Pergunte sobre roles SAP, usuários, bukrs ou políticas RLS..."
          rows={1}
          className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-700 rounded-xl pl-3.5 pr-11 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-[#1a73e8] text-[#202124] dark:text-zinc-100 placeholder-[#80868b] dark:placeholder-zinc-500 resize-none overscroll-contain"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="absolute right-5 bottom-5 p-2 bg-[#1a73e8] hover:bg-[#1557b0] rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          title="Enviar pergunta"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
