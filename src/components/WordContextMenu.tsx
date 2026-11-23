import { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  Languages,
  Loader2,
  Volume2,
  X,
} from 'lucide-react';
import { getLexiconSpeechText } from '../data/fallbackLexicon';
import { ProficiencyLevel, WordAnalysis } from '../types/arabic';
import { applySmartPartialTashkeel, speakArabic, stopArabicSpeech, unlockArabicAudioContext } from '../utils/arabic';

export interface ActiveWordSelection {
  word: string;
  contextSentence: string;
  lessonLevel?: ProficiencyLevel;
  anchorRect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
  };
}

interface WordContextMenuProps {
  selection: ActiveWordSelection | null;
  mode: 'menu' | 'translation';
  loading: boolean;
  savingVocab: boolean;
  error: string | null;
  analysis: WordAnalysis | null;
  isAlreadySaved: boolean;
  justSaved: boolean;
  speechRate: number;
  onTranslate: () => void;
  onAddToVocabulary: () => void;
  onOpenVocabulary: () => void;
  onClose: () => void;
}

export function WordContextMenu({
  selection,
  mode,
  loading,
  savingVocab,
  error,
  analysis,
  isAlreadySaved,
  justSaved,
  speechRate,
  onTranslate,
  onAddToVocabulary,
  onOpenVocabulary,
  onClose,
}: WordContextMenuProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [speakingTarget, setSpeakingTarget] = useState<'word' | number | null>(null);
  const [audioPhase, setAudioPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    setSpeakingTarget(null);
    setAudioPhase('idle');
    setAudioError(null);
  }, [selection?.word, selection?.contextSentence, mode]);

  useEffect(() => {
    if (!selection) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null;
        if (target?.dataset?.arabicWord === 'true') return;
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selection, onClose]);

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!selection) return null;

  const viewportW = viewportWidth;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const isMobileSheet = viewportW < 640;
  const popoverWidth = Math.min(viewportW - 24, mode === 'translation' ? 390 : 304);

  let left = selection.anchorRect.left + selection.anchorRect.width / 2 - popoverWidth / 2;
  left = Math.max(12, Math.min(left, viewportW - popoverWidth - 12));

  const estimatedHeight = mode === 'translation' ? 360 : 196;
  const spaceBelow = viewportH - selection.anchorRect.bottom;
  const placeAbove = spaceBelow < estimatedHeight && selection.anchorRect.top > estimatedHeight;

  const top = placeAbove
    ? Math.max(12, selection.anchorRect.top - estimatedHeight - 10)
    : Math.min(viewportH - estimatedHeight - 12, selection.anchorRect.bottom + 10);

  const handlePlayAudio = (text: string, target: 'word' | number) => {
    unlockArabicAudioContext();
    setAudioError(null);

    if (audioPhase === 'loading') {
      return;
    }
    if (speakingTarget === target) {
      stopArabicSpeech();
      setSpeakingTarget(null);
      setAudioPhase('idle');
      return;
    }
    if (target === 'word') {
      const vocalizedText =
        analysis?.vocalizedWord ||
        getLexiconSpeechText(
          analysis?.word || selection.word,
          analysis?.wordWithTashkeel || selection.word,
          analysis?.wordType,
          analysis?.partOfSpeech
        );
      speakArabic(text, {
        rate: speechRate,
        mode: 'word',
        vocalizedText,
        meaningHint: analysis?.englishMeaning,
        wordType: analysis?.wordType,
        partOfSpeech: analysis?.partOfSpeech,
        onLoading: () => {
          setSpeakingTarget(target);
          setAudioPhase('loading');
        },
        onStart: () => {
          setSpeakingTarget(target);
          setAudioPhase('playing');
        },
        onEnd: () => {
          setSpeakingTarget((curr) => {
            if (curr === target) {
              setAudioPhase('idle');
              return null;
            }
            return curr;
          });
        },
        onError: (msg) => {
          setSpeakingTarget(null);
          setAudioPhase('idle');
          setAudioError(msg);
        },
      });
    } else {
      speakArabic(text, {
        rate: speechRate,
        mode: 'example',
        onLoading: () => {
          setSpeakingTarget(target);
          setAudioPhase('loading');
        },
        onStart: () => {
          setSpeakingTarget(target);
          setAudioPhase('playing');
        },
        onEnd: () => {
          setSpeakingTarget((curr) => {
            if (curr === target) {
              setAudioPhase('idle');
              return null;
            }
            return curr;
          });
        },
        onError: (msg) => {
          setSpeakingTarget(null);
          setAudioPhase('idle');
          setAudioError(msg);
        },
      });
    }
  };

  return (
    <>
      {isMobileSheet && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-[#182111]/45 backdrop-blur-[1px]"
        />
      )}
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="Arabic word actions"
        style={
          isMobileSheet
            ? undefined
            : {
                position: 'fixed',
                top: `${top}px`,
                left: `${left}px`,
                width: `${popoverWidth}px`,
              }
        }
        className={
          isMobileSheet
            ? 'animate-popover-in fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-[#DCE5D3] bg-[#FAFBF8]/98 backdrop-blur-md shadow-2xl shadow-[#182111]/25 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[82dvh] flex flex-col'
            : 'animate-popover-in z-50 rounded-2xl border border-[#DCE5D3] bg-white/98 backdrop-blur-md shadow-2xl shadow-[#182111]/18 max-h-[82vh] flex flex-col'
        }
      >
        {isMobileSheet && (
          <div className="flex justify-center pt-2.5 pb-0.5 shrink-0" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-[#DCE5D3]" />
          </div>
        )}

        {/* Header row */}
        <div className="flex items-center justify-between gap-3 border-b border-[#DCE5D3] px-4 py-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-2xl font-bold text-[#1F2718] leading-normal truncate"
            >
              {applySmartPartialTashkeel(analysis?.wordWithTashkeel || selection.word)}
            </span>
            <button
              type="button"
              onClick={() => handlePlayAudio(analysis?.wordWithTashkeel || selection.word, 'word')}
              title={speakingTarget === 'word' && audioPhase === 'loading' ? 'Loading audio...' : 'Listen to pronunciation'}
              aria-label="Listen to pronunciation"
              className={`inline-flex h-10 w-10 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg transition-all cursor-pointer touch-manipulation ${
                speakingTarget === 'word'
                  ? 'bg-[#2D3B22] text-[#E8B948] ring-4 ring-[#DCE5D3]'
                  : 'bg-[#FBF3DC] text-[#9A6F14] hover:bg-[#E8B948]/30'
              }`}
            >
              {speakingTarget === 'word' && audioPhase === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Volume2
                  className={`h-4 w-4 ${speakingTarget === 'word' ? 'animate-pulse' : ''}`}
                  aria-hidden="true"
                />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close word menu"
            className="inline-flex h-10 w-10 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#1F2718] transition-colors cursor-pointer touch-manipulation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {audioError && (
          <p className="mx-4 mt-2 rounded-lg border border-orange-200 bg-[#FEF2E8] px-3 py-1.5 text-[11px] font-medium text-amber-950">
            {audioError}
          </p>
        )}

        {/* Menu mode */}
        {mode === 'menu' && (
          <div className="p-2.5 sm:p-2 space-y-1.5 sm:space-y-1">
            <button
              type="button"
              onClick={onTranslate}
              className="flex w-full min-h-[44px] items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#1F2718] hover:bg-[#EEF2E9] transition-colors cursor-pointer touch-manipulation"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FBF3DC] text-[#9A6F14]">
                  <Languages className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>Translate</span>
              </span>
              <span dir="rtl" lang="ar" className="font-arabic-cairo text-xs font-semibold text-[#5A6552]">
                ترجمة
              </span>
            </button>

            <button
              type="button"
              onClick={onAddToVocabulary}
              disabled={savingVocab}
              className="flex w-full min-h-[44px] items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#1F2718] hover:bg-[#EEF2E9] disabled:opacity-60 transition-colors cursor-pointer touch-manipulation"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#2D3B22]">
                  {savingVocab ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#D4A338]" aria-hidden="true" />
                  ) : isAlreadySaved ? (
                    <CheckCircle2 className="h-4 w-4 text-[#2D3B22]" aria-hidden="true" />
                  ) : (
                    <BookmarkPlus className="h-4 w-4 text-[#2D3B22]" aria-hidden="true" />
                  )}
                </span>
                <span>{isAlreadySaved ? 'Saved in Vocabulary' : 'Add to My Vocabulary'}</span>
              </span>
              <span dir="rtl" lang="ar" className="font-arabic-cairo text-xs font-semibold text-[#5A6552]">
                إضافة للمفردات
              </span>
            </button>

            {error && (
              <p className="px-3 py-2 text-xs text-amber-950 bg-[#FEF2E8] border border-orange-200 rounded-lg">{error}</p>
            )}
          </div>
        )}

        {/* Translation mode with Loading Skeleton & Polysemy Contexts */}
        {mode === 'translation' && (
          <div className="p-4 space-y-3.5 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="space-y-3 py-1" aria-busy="true" aria-label="Loading translation">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-16 rounded bg-[#EEF2E9] animate-pulse" />
                  <div className="h-3 w-20 rounded bg-[#EEF2E9] animate-pulse" />
                </div>
                <div className="h-5 w-3/4 rounded bg-[#DCE5D3] animate-pulse" />
                <div className="h-9 w-full rounded-lg bg-[#EEF2E9] animate-pulse" />
              </div>
            ) : error ? (
              <div className="space-y-2.5">
                <p className="text-xs text-amber-950 bg-[#FEF2E8] border border-orange-200 rounded-lg p-2.5">{error}</p>
                <button
                  type="button"
                  onClick={onTranslate}
                  className="text-xs font-semibold text-[#2D3B22] hover:underline cursor-pointer"
                >
                  Try again
                </button>
              </div>
            ) : analysis ? (
              <>
                {analysis.notice && (
                  <p className="rounded-lg border border-amber-200 bg-[#FBF3DC]/70 px-3 py-1.5 text-[11px] font-medium text-[#7A560B]">
                    {analysis.notice}
                  </p>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A6552]">
                    <span className="font-semibold text-[#2D3B22]">{analysis.partOfSpeech}</span>
                    {analysis.transliteration && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{analysis.transliteration}</span>
                      </>
                    )}
                  </div>

                  <p className="text-base font-bold text-[#1F2718] leading-snug">
                    {analysis.englishMeaning}
                  </p>
                </div>

                {/* Contextual & Polysemous Real-Life Sentences */}
                {analysis.examples?.length > 0 && (
                  <div className="space-y-2">
                    {analysis.examples.slice(0, 2).map((ex, idx) => {
                      const isPlaying = speakingTarget === idx;
                      return (
                        <div
                          key={idx}
                          className="rounded-xl bg-[#FAFBF8] border border-[#DCE5D3] px-3 py-2.5 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9A6F14]">
                              {ex.contextLabel || (idx === 0 ? 'Everyday Context' : 'Alternate Meaning')}
                            </span>
                            <button
                              type="button"
                              onClick={() => handlePlayAudio(ex.arabic, idx)}
                              aria-label={`Listen to example ${idx + 1}`}
                              className={`inline-flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded-md transition-all cursor-pointer touch-manipulation ${
                                isPlaying
                                  ? 'bg-[#2D3B22] text-[#E8B948] ring-2 ring-[#DCE5D3]'
                                  : 'text-[#9A6F14] hover:bg-[#FBF3DC]'
                              }`}
                            >
                              {isPlaying && audioPhase === 'loading' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Volume2
                                  className={`h-3.5 w-3.5 ${isPlaying ? 'animate-pulse' : ''}`}
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          </div>
                          <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-lg text-[#1F2718] leading-[2.0]">
                            {applySmartPartialTashkeel(ex.arabic)}
                          </p>
                          <p className="text-xs text-[#5A6552] leading-relaxed">{ex.english}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-[#DCE5D3] pt-3 flex items-center justify-between gap-2">
                  {isAlreadySaved || justSaved ? (
                    <button
                      type="button"
                      onClick={onOpenVocabulary}
                      className="inline-flex min-h-[40px] sm:min-h-0 items-center gap-1.5 text-xs font-semibold text-[#2D3B22] hover:text-[#3E522D] hover:underline cursor-pointer touch-manipulation"
                    >
                      <CheckCircle2 className="h-4 w-4 text-[#D4A338]" aria-hidden="true" />
                      <span>Saved · Open 3D Flashcard</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onAddToVocabulary}
                      disabled={savingVocab}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#2D3B22] px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-[#3E522D] disabled:opacity-60 transition-colors cursor-pointer touch-manipulation active:scale-[0.98]"
                    >
                      {savingVocab ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E8B948]" aria-hidden="true" />
                          <span>Building 3D Flashcard...</span>
                        </>
                      ) : (
                        <>
                          <BookmarkPlus className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
                          <span>Add to My Vocabulary · إضافة للمفردات</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
